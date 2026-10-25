import http.server
import socketserver
import webbrowser
import os
import sys

PORT = 5055
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        super().end_headers()

def run():
    os.chdir(DIRECTORY)
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"=====================================================")
        print(f" GoodNotes Windows App running at: http://localhost:{PORT}")
        print(f"=====================================================")
        
        edge_path = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
        chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
        
        url = f"http://localhost:{PORT}"
        app_arg = f"--app={url}"
        
        launched = False
        if os.path.exists(edge_path):
            try:
                os.spawnl(os.P_NOWAIT, edge_path, "msedge", app_arg)
                launched = True
            except Exception:
                pass
        
        if not launched and os.path.exists(chrome_path):
            try:
                os.spawnl(os.P_NOWAIT, chrome_path, "chrome", app_arg)
                launched = True
            except Exception:
                pass
                
        if not launched:
            webbrowser.open(url)
            
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down GoodNotes server.")

if __name__ == "__main__":
    run()
