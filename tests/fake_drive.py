"""A small stand-in for Google's sign-in page and the Drive v3 API, for browser tests.

Only what Diamond DJ uses: sign-in redirect, files.get (metadata and alt=media), files.list by
parent, about, folder create, resumable upload, media update. Everything lives in memory.
The next sign-in uses the account set with  GET /_account?name=organizer|volunteer.
organizer (Diamond DJ Admin) can edit everything; coach (a team organizer) can edit inside team
folders but not the Diamond DJ folder itself, Common Songs or the library file; volunteer can only view.
"""
import hashlib, itertools, json, re, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, urlencode, quote

FOLDER = 'application/vnd.google-apps.folder'


class FakeDrive:
    def __init__(self):
        self.files = {}
        self.ids = itertools.count(1)
        self.sessions = {}
        self.account = 'organizer'
        self.clock = 0
        self.add('ROOTFOLDER01', 'Diamond DJ', FOLDER, None)
        # sharing: direct permissions per file; a folder's sharing reaches everything inside it
        self.perms = {'ROOTFOLDER01': [{'id': 'P0', 'type': 'user', 'role': 'owner', 'emailAddress': 'organizer@example.com', 'displayName': 'Organizer'}]}
        self.emails = []   # (to, message) for each "shared with you" email Google would send

    RANK = {'reader': 0, 'commenter': 1, 'writer': 2, 'organizer': 3, 'owner': 4}

    def effective(self, fid):
        # this file's own sharing plus what it gets from the folders it's in (same id; the highest role wins)
        out, chain, f = {}, [], self.files.get(fid)
        while f:
            chain.append(f['id'])
            f = self.files.get(f['parents'][0]) if f['parents'] else None
        for i, cid in enumerate(chain):
            for p in self.perms.get(cid, []):
                key = p.get('emailAddress', '').lower() or p['type']
                if key not in out or self.RANK[p['role']] > self.RANK[out[key]['role']]:
                    out[key] = dict(p)
        return list(out.values())

    def share(self, fid, email=None, role='reader', type='user'):
        lst = self.perms.setdefault(fid, [])
        for p in lst:
            if (type == 'user' and p.get('emailAddress', '').lower() == (email or '').lower()) or (type != 'user' and p['type'] == type):
                p['role'] = role
                return p
        # like Google: a person has the same permission id on every file (their account's id)
        p = {'id': 'anyoneWithLink' if type == 'anyone' else 'U' + re.sub(r'\W', '', (email or '').lower()), 'type': type, 'role': role}
        if email: p.update(emailAddress=email, displayName=email.split('@')[0])
        lst.append(p)
        return p

    def direct(self, fid, pid):
        return next((p for p in self.perms.get(fid, []) if p['id'] == pid), None)

    def now(self):
        self.clock += 1
        return time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime()) + '.%03dZ' % (self.clock % 1000)

    def add(self, fid, name, mime, parent, data=b''):
        f = {'id': fid, 'name': name, 'mimeType': mime, 'parents': [parent] if parent else [], 'data': data,
             'modifiedTime': self.now()}
        self.files[fid] = f
        return f

    def meta(self, f, editor):
        m = {k: f[k] for k in ('id', 'name', 'mimeType', 'modifiedTime')}
        if f['mimeType'] != FOLDER:
            m['size'] = str(len(f['data']))
            m['md5Checksum'] = hashlib.md5(f['data']).hexdigest()
        m['capabilities'] = {'canAddChildren': editor}
        return m

    def top(self, f):
        # the folder right under ROOTFOLDER01 that holds f (None for the root itself)
        while f['parents'] and f['parents'][0] != 'ROOTFOLDER01':
            f = self.files[f['parents'][0]]
        return f if f['parents'] else None

    def can_edit(self, acct, fid):
        if acct == 'organizer': return True
        if acct != 'coach' or fid not in self.files: return False
        t = self.top(self.files[fid])
        return bool(t) and t['mimeType'] == FOLDER and t['name'] != 'Common Songs'

    def children(self, parent):
        return [f for f in self.files.values() if parent in f['parents']]

    def path_of(self, f):
        parts = [f['name']]
        while f['parents'] and f['parents'][0] != 'ROOTFOLDER01':
            f = self.files[f['parents'][0]]
            parts.insert(0, f['name'])
        return '/'.join(parts)

    def tree(self):
        return sorted(self.path_of(f) for f in self.files.values() if f['id'] != 'ROOTFOLDER01')


def make_handler(drive):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def cors(self):
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Upload-Content-Type')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
            self.send_header('Access-Control-Expose-Headers', 'Location')

        def reply(self, code, body=b'', ctype='application/json', headers=None):
            if isinstance(body, (dict, list)):
                body = json.dumps(body).encode()
            self.send_response(code)
            self.cors()
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(body)))
            for k, v in (headers or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def who(self):
            m = re.match(r'Bearer tok-(\w+)', self.headers.get('Authorization', ''))
            return m.group(1) if m else None

        def body(self):
            n = int(self.headers.get('Content-Length') or 0)
            return self.rfile.read(n) if n else b''

        def do_OPTIONS(self):
            self.send_response(204)
            self.cors()
            self.end_headers()

        def do_GET(self):
            u = urlparse(self.path)
            q = {k: v[0] for k, v in parse_qs(u.query).items()}
            if u.path == '/_account':
                drive.account = q['name']
                return self.reply(200, {'ok': True})
            if u.path == '/_tree':
                return self.reply(200, drive.tree())
            if u.path == '/_share':
                return self.reply(200, drive.share(q['fid'], q.get('email'), q.get('role', 'reader'), q.get('type', 'user')))
            if u.path == '/_perms':
                return self.reply(200, {'perms': drive.perms, 'emails': drive.emails, 'folders': {f['name']: f['id'] for f in drive.files.values() if f['mimeType'] == FOLDER}})
            if u.path == '/auth':
                scope = q.get('scope', '')
                frag = urlencode({'access_token': 'tok-' + drive.account, 'token_type': 'Bearer', 'expires_in': 3600,
                                  'scope': scope, 'state': q.get('state', '')}, quote_via=quote)
                self.send_response(302)
                self.send_header('Location', q['redirect_uri'] + '#' + frag)
                self.end_headers()
                return
            acct = self.who()
            if not acct:
                return self.reply(401, {'error': {'status': 'UNAUTHENTICATED'}})
            if u.path == '/drive/v3/about':
                return self.reply(200, {'user': {'emailAddress': acct + '@example.com'}})
            if u.path == '/drive/v3/files':
                m = re.match(r"'([\w-]+)' in parents", q.get('q', ''))
                files = drive.children(m.group(1)) if m else []
                return self.reply(200, {'files': [drive.meta(f, drive.can_edit(acct, f['id'])) for f in files]})
            m = re.match(r'/drive/v3/files/([\w-]+)/permissions$', u.path)
            if m and m.group(1) in drive.files:
                return self.reply(200, {'permissions': drive.effective(m.group(1))})
            m = re.match(r'/drive/v3/files/([\w-]+)$', u.path)
            if m and m.group(1) in drive.files:
                f = drive.files[m.group(1)]
                if q.get('alt') == 'media':
                    return self.reply(200, f['data'], 'application/octet-stream')
                return self.reply(200, drive.meta(f, drive.can_edit(acct, f['id'])))
            return self.reply(404, {'error': {'status': 'NOT_FOUND'}})

        def write_allowed(self, target=None):
            acct = self.who()
            if not acct:
                self.reply(401, {'error': {'status': 'UNAUTHENTICATED'}})
                return False
            if not (acct == 'organizer' or (target and drive.can_edit(acct, target))):
                self.reply(403, {'error': {'errors': [{'reason': 'insufficientFilePermissions'}]}})
                return False
            return True

        def do_POST(self):
            u = urlparse(self.path)
            q = {k: v[0] for k, v in parse_qs(u.query).items()}
            meta = json.loads(self.body() or b'{}')
            m = re.match(r'/drive/v3/files/([\w-]+)/permissions$', u.path)
            if m:
                if not self.write_allowed(m.group(1)):
                    return
                if not re.match(r'^[^@\s]+@[^@\s]+\.\w+$', meta.get('emailAddress', '')):
                    return self.reply(400, {'error': {'errors': [{'reason': 'invalidSharingRequest'}]}})
                p = drive.share(m.group(1), meta['emailAddress'], meta['role'])
                if q.get('sendNotificationEmail') == 'true':
                    drive.emails.append((meta['emailAddress'], q.get('emailMessage', '')))
                return self.reply(200, p)
            if not self.write_allowed((meta.get('parents') or [None])[0]):
                return
            if u.path == '/drive/v3/files':
                f = drive.add('F%d' % next(drive.ids), meta['name'], meta.get('mimeType', 'application/octet-stream'), meta['parents'][0])
                return self.reply(200, drive.meta(f, True))
            if u.path == '/upload/drive/v3/files' and q.get('uploadType') == 'resumable':
                sid = 'S%d' % next(drive.ids)
                drive.sessions[sid] = (meta, self.headers.get('X-Upload-Content-Type', 'application/octet-stream'))
                host = self.headers.get('Host')
                return self.reply(200, {}, headers={'Location': f'http://{host}/upload/session/{sid}'})
            return self.reply(400, {'error': {'status': 'BAD_REQUEST'}})

        def do_PUT(self):
            m = re.match(r'/upload/session/(\w+)$', urlparse(self.path).path)
            if not m or not self.write_allowed(drive.sessions[m.group(1)][0]['parents'][0]):
                return
            meta, mime = drive.sessions.pop(m.group(1))
            f = drive.add('F%d' % next(drive.ids), meta['name'], mime, meta['parents'][0], self.body())
            return self.reply(200, drive.meta(f, True))

        def perm_target(self):
            m = re.match(r'/drive/v3/files/([\w-]+)/permissions/([\w-]+)$', urlparse(self.path).path)
            if not m or not self.write_allowed(m.group(1)):
                return None, None
            p = drive.direct(m.group(1), m.group(2))
            if not p or p['role'] == 'owner':
                self.reply(403, {'error': {'errors': [{'reason': 'cannotModifyInheritedPermission' if not p else 'invalidOwnershipTransferRequest'}]}})
                return None, None
            return m.group(1), p

        def do_DELETE(self):
            fid, p = self.perm_target()
            if p:
                drive.perms[fid].remove(p)
                self.reply(204)

        def do_PATCH(self):
            if '/permissions/' in self.path:
                fid, p = self.perm_target()
                if p:
                    p['role'] = json.loads(self.body() or b'{}').get('role', p['role'])
                    self.reply(200, p)
                return
            m = re.match(r'/upload/drive/v3/files/([\w-]+)$', urlparse(self.path).path)
            if not m or m.group(1) not in drive.files or not self.write_allowed(m.group(1)):
                return
            f = drive.files[m.group(1)]
            f['data'] = self.body()
            f['modifiedTime'] = drive.now()
            return self.reply(200, drive.meta(f, True))

    return H


def start():
    drive = FakeDrive()
    srv = ThreadingHTTPServer(('127.0.0.1', 0), make_handler(drive))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return drive, f'http://127.0.0.1:{srv.server_address[1]}'
