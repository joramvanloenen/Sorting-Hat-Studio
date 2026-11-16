"""Quick HTTP API smoke test; runs entirely in simulation mode."""
import json
import sys
import tempfile
import threading
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest import mock

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import hat_core
from server import HatHandler

with tempfile.TemporaryDirectory() as tmp:
    path=Path(tmp)
    with mock.patch.object(hat_core,'AUDIO',path/'audio'),mock.patch.object(hat_core,'PROJECT_FILE',path/'project.json'),mock.patch.object(hat_core,'SETTINGS_FILE',path/'settings.json'):
        engine=hat_core.HatEngine(hardware=False)
        httpd=ThreadingHTTPServer(('127.0.0.1',0),HatHandler)
        httpd.engine=engine
        thread=threading.Thread(target=httpd.serve_forever,daemon=True)
        thread.start()
        base=f'http://127.0.0.1:{httpd.server_address[1]}'
        try:
            with urllib.request.urlopen(base) as f:
                html=f.read().decode()
                assert 'Sorting Hat' in html
            with urllib.request.urlopen(base+'/api/project') as f:
                project=json.load(f)
                assert len(project['clips'])==6
            with urllib.request.urlopen(base+'/api/status') as f:
                status=json.load(f)
                assert status['hardware'] is False
            c=project['clips'][0];c['title']='Edited from test'
            req=urllib.request.Request(base+'/api/clip/intro',json.dumps(c).encode(),{'Content-Type':'application/json'},method='POST')
            with urllib.request.urlopen(req) as f:
                saved=json.load(f)
                assert saved['title']==c['title']
            with urllib.request.urlopen(base+'/style.css') as f:
                assert b'.stage' in f.read()
            with urllib.request.urlopen(base+'/app.js') as f:
                assert b'generateJaw' in f.read()
            print('HTTP smoke: passed (HTML, CSS, JS, project, status, clip save).')
        finally:
            httpd.shutdown();httpd.server_close();engine.close()
