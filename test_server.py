import io, json, os, socket, sys, threading, time, unittest, urllib.request
from unittest.mock import patch
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import server

class StubResponse:
    def __init__(self, value): self.body=io.BytesIO(json.dumps(value).encode())
    def __enter__(self): return self.body
    def __exit__(self, *args): self.body.close()

def mock_model(repairs):
    return StubResponse({'choices':[{'finish_reason':'stop','message':{'content':json.dumps({'summary':'Review','repairs':repairs,'uncertainties':[]})}}]})

class RepairTests(unittest.TestCase):
    @patch.dict(os.environ, {'NEBIUS_API_KEY':'secret-key', 'CUSTOM_PRIVATE_TOKEN':'private-token', 'NODE_PATH':'example-path'})
    def test_browser_environment_excludes_application_secrets(self):
        env=server.browser_env()
        self.assertNotIn('NEBIUS_API_KEY',env)
        self.assertNotIn('CUSTOM_PRIVATE_TOKEN',env)
        self.assertEqual(env['NODE_PATH'],'example-path')
    def test_rejects_unknown_and_duplicate_ids(self):
        for values in (['unknown'], ['image_alt','image_alt'], None):
            with self.assertRaises(ValueError): server.candidate(values)
    def test_selected_fixture_edits_are_exact(self):
        candidate=server.candidate(['email_label'])
        self.assertIn('for="email"',candidate)
        self.assertNotIn('alt=""',candidate)
    @patch.dict(os.environ, {'NEBIUS_API_KEY':'test-key'})
    def test_local_drops_unsubstantiated_decorative_and_existing_label(self):
        source='<label for="email">Email</label><input id="email"><img src="logo.png">'
        repairs=[{'original_tag':'<input id="email">','attribute':'aria-label','value':'Email','reason':'x'}, {'original_tag':'<img src="logo.png">','attribute':'alt','value':'','reason':'x'}]
        with patch('urllib.request.urlopen',return_value=mock_model(repairs)):
            result=server.local_propose(source)
        self.assertEqual(result['proposal']['repairs'],[])
        self.assertEqual(result['candidate_source'],source)
    @patch.dict(os.environ, {'NEBIUS_API_KEY':'test-key'})
    def test_local_refuses_to_override_wrapping_or_referenced_label(self):
        cases=[
            ('<label>Email address <input id="email"></label>', '<input id="email">'),
            ('<span id="email-label">Email</span><input id="email" aria-labelledby="email-label">', '<input id="email" aria-labelledby="email-label">'),
            ('<label for=email>Email address</label><input id=email>', '<input id=email>'),
        ]
        for source,tag in cases:
            repair=[{'original_tag':tag,'attribute':'aria-label','value':'Invented name','reason':'x'}]
            with self.subTest(source=source), patch('urllib.request.urlopen',return_value=mock_model(repair)):
                result=server.local_propose(source)
                self.assertEqual(result['proposal']['repairs'],[])
                self.assertEqual(result['candidate_source'],source)
    @patch.dict(os.environ, {'NEBIUS_API_KEY':'test-key'})
    def test_refuses_tag_shaped_script_data(self):
        source="<script>const template = '<input id=\"email\">';</script><p>no email control</p>"
        repair=[{'original_tag':'<input id="email">','attribute':'aria-label','value':'Email','reason':'x'}]
        with patch('urllib.request.urlopen',return_value=mock_model(repair)):
            result=server.local_propose(source)
        self.assertEqual(result['proposal']['repairs'],[])
        self.assertEqual(result['candidate_source'],source)
    @patch.dict(os.environ, {'NEBIUS_API_KEY':'test-key'})
    def test_local_escapes_values_and_rejects_script_tags(self):
        source='<input id="q"><script>hi()</script>'
        repairs=[{'original_tag':'<input id="q">','attribute':'aria-label','value':'Name" onfocus="evil','reason':'x'}, {'original_tag':'<script>','attribute':'aria-label','value':'x','reason':'x'}]
        with patch('urllib.request.urlopen',return_value=mock_model(repairs)):
            result=server.local_propose(source)
        self.assertEqual(len(result['proposal']['repairs']),1)
        self.assertIn('Name&amp;quot;',result['candidate_source'].replace('&quot;','&amp;quot;'))
        self.assertEqual(result['candidate_source'].count('<script>'),1)
    @patch.dict(os.environ, {'NEBIUS_API_KEY':'test-key'})
    def test_native_button_conversion_is_constrained(self):
        source='<div id="send">Send</div><div id="complex"><span>Bad</span></div>'
        repairs=[{'original_tag':'<div id="send">Send</div>','attribute':'native-button','value':'','reason':'x'}, {'original_tag':'<div id="complex"><span>Bad</span></div>','attribute':'native-button','value':'','reason':'x'}]
        with patch('urllib.request.urlopen',return_value=mock_model(repairs)):
            result=server.local_propose(source)
        self.assertEqual(len(result['proposal']['repairs']),1)
        self.assertIn('<button id="send" type="button">Send</button>',result['candidate_source'])
        self.assertIn('<div id="complex"><span>Bad</span></div>',result['candidate_source'])
    @patch.dict(os.environ, {'NEBIUS_API_KEY':'test-key'})
    def test_named_div_group_repair_requires_name_and_preserves_existing_role(self):
        source='<div class="table-scroll" tabindex="0" aria-label="Compiler comparison table">table</div><div id="unnamed">x</div><div aria-label="Existing" role="region">x</div>'
        repairs=[{'original_tag':'<div class="table-scroll" tabindex="0" aria-label="Compiler comparison table">','attribute':'role','value':'group','reason':'Named group'}, {'original_tag':'<div id="unnamed">','attribute':'role','value':'group','reason':'x'}, {'original_tag':'<div aria-label="Existing" role="region">','attribute':'role','value':'group','reason':'x'}]
        with patch('urllib.request.urlopen',return_value=mock_model(repairs)):
            result=server.local_propose(source)
        self.assertEqual(len(result['proposal']['repairs']),1)
        self.assertIn('aria-label="Compiler comparison table" role="group"',result['candidate_source'])
        self.assertIn('<div id="unnamed">',result['candidate_source'])
        self.assertIn('role="region"',result['candidate_source'])
        self.assertIn('This proposal request sent',result['limitations'][0])
    @patch.dict(os.environ, {'NEBIUS_API_KEY':'test-key'})
    def test_model_source_cap_allows_real_size_and_rejects_over_limit(self):
        source='<p>'+('x'*17556)+'</p>'
        with patch('urllib.request.urlopen',return_value=mock_model([])):
            self.assertEqual(server.local_propose(source)['candidate_source'],source)
        with self.assertRaises(ValueError):server.local_propose('x'*24001)
        with self.assertRaises(ValueError):server.local_propose('💡'*24001)
    def test_verification_disclosure_is_request_specific(self):
        http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        thread=threading.Thread(target=http.serve_forever,daemon=True);thread.start()
        payload={'source':'<button>One</button>','candidate_source':'<button>One</button>','journey':['Tab'],'consent':True}
        try:
            with patch.object(server,'audit',return_value={'checks':[],'keyboard':[],'summary':{'passed':0,'total':0}}):
                req=urllib.request.Request(f'http://127.0.0.1:{http.server_port}/api/local-verify',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'})
                with urllib.request.urlopen(req,timeout=3) as response:result=json.load(response)
            self.assertIn('verification request does not send HTML to Nebius',result['limitations'][0])
            self.assertFalse(any('source was sent' in item.lower() for item in result['limitations']))
        finally:http.shutdown();http.server_close();thread.join(3)
    def test_browser_blocks_http_and_websocket_connections(self):
        listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen();listener.settimeout(3)
        port=listener.getsockname()[1]; received=[]
        def capture():
            try:
                connection,_=listener.accept();received.append(connection.recv(1024));connection.close()
            except socket.timeout:pass
        thread=threading.Thread(target=capture,daemon=True);thread.start()
        source=f"<button>One</button><script>fetch('http://127.0.0.1:{port}/fetch').catch(()=>{{}});new WebSocket('ws://127.0.0.1:{port}/socket')</script>"
        try:
            server.audit(source,'local',['Tab'])
            thread.join(4)
            self.assertFalse(thread.is_alive(),'listener timed out unexpectedly')
            self.assertEqual(received,[],'browser reached the local network listener')
        finally:listener.close()
    def test_webrtc_guard_blocks_observed_turn_attempt(self):
        listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen();listener.settimeout(3)
        port=listener.getsockname()[1];received=[]
        def capture():
            try:
                connection,_=listener.accept();received.append(connection.recv(1024));connection.close()
            except socket.timeout:pass
        thread=threading.Thread(target=capture,daemon=True);thread.start()
        source=f"<button id='check'>pending</button><script>document.querySelector('#check').textContent=typeof RTCPeerConnection === 'undefined' ? 'unavailable' : 'available'; if(typeof RTCPeerConnection !== 'undefined'){{let pc=new RTCPeerConnection({{iceServers:[{{urls:'turn:127.0.0.1:{port}?transport=tcp',username:'probe',credential:'probe'}}]}});pc.createDataChannel('probe');pc.createOffer().then(x=>pc.setLocalDescription(x));}}</script>"
        try:
            result=server.audit(source,'local',['Tab'])
            self.assertEqual(result['keyboard'][0]['name'],'unavailable')
            thread.join(4)
            self.assertFalse(thread.is_alive())
            self.assertEqual(received,[],'WebRTC reached the TURN listener')
        finally:listener.close()
    def test_slow_request_body_releases_work_slots(self):
        class FastTimeoutHandler(server.Handler): body_read_timeout=0.25
        http=server.ThreadingHTTPServer(('127.0.0.1',0),FastTimeoutHandler)
        thread=threading.Thread(target=http.serve_forever,daemon=True);thread.start()
        port=http.server_port; clients=[]
        try:
            for _ in range(2):
                client=socket.create_connection(('127.0.0.1',port),timeout=2);clients.append(client)
                client.sendall(f'POST /api/verify HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n'.encode())
            for client in clients:
                client.settimeout(3)
                self.assertIn(b'408',client.recv(1024))
            # Both semaphore slots must be available after the incomplete reads expire.
            with patch.object(server,'verify',return_value={'ok':True}):
                req=urllib.request.Request(f'http://127.0.0.1:{port}/api/verify',data=b'{"repair_ids":[]}',headers={'Content-Type':'application/json'})
                with urllib.request.urlopen(req,timeout=3) as response:self.assertEqual(response.status,200)
        finally:
            for client in clients:client.close()
            http.shutdown();http.server_close();thread.join(3)
    def test_bundle_validation_rejects_unsafe_paths_and_duplicates(self):
        for path in ('../x.js','/x.js','a/../x.js','a\\x.js','C:/x.js','a/%2e%2e/x.js','a/x.js?query','a/x.html','a//x.js','a/./x.js'):
            with self.subTest(path=path), self.assertRaises(ValueError):server.validate_assets([{'path':path,'content':''}])
        with self.assertRaises(ValueError):server.validate_assets([{'path':'x.js','content':''},{'path':'x.js','content':''}])
        with self.assertRaises(ValueError):server.validate_assets([{'path':'x.js','content':'x'*500001}])
    def test_bundle_serves_selected_assets_and_reports_failures(self):
        source="""<!doctype html><link rel='stylesheet' href='styles/main.css?v=1'><link rel='stylesheet' href='styles/missing.css'><script src='https://example.com/blocked.js'></script><button id='a'>Open</button><button id='b'>Next</button><script src='scripts/app.js'></script>"""
        assets=server.validate_assets([{'path':'styles/main.css','content':'#a{color:rgb(1, 2, 3)}'}, {'path':'scripts/app.js','content':"const a=document.querySelector('#a');a.textContent=getComputedStyle(a).color;a.onkeydown=e=>{if(e.key==='ArrowDown')document.querySelector('#b').focus()}"}])
        result=server.audit(source,'local',['Tab','ArrowDown'],assets)
        self.assertEqual(result['keyboard'][0]['name'],'rgb(1, 2, 3)')
        self.assertEqual(result['keyboard'][1]['target'],'b')
        self.assertEqual({x['path'] for x in result['resources']['loaded']},{'styles/main.css','scripts/app.js'})
        self.assertTrue(any('missing.css' in x['url'] for x in result['resources']['missing']))
        self.assertTrue(any('example.com' in x['url'] for x in result['resources']['blocked']))
    def test_browser_dynamic_focus_and_fixture_partial_repair(self):
        source="<button id='a'>Open</button><button id='b'>Next</button><script>document.querySelector('#a').addEventListener('keydown',e=>{if(e.key==='ArrowDown')document.querySelector('#b').focus()})</script>"
        report=server.audit(source,'local',['Tab','ArrowDown'])
        self.assertEqual([x['target'] for x in report['keyboard']],['a','b'])
        result=server.verify(['email_label','submit_semantics'])
        self.assertEqual(result['before']['summary']['passed'],0)
        self.assertEqual(result['after']['summary']['passed'],2)

if __name__=='__main__': unittest.main()
