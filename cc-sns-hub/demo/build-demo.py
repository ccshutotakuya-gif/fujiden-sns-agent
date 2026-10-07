"""src/index.html からデモ版 demo/index.html を作る: python3 demo/build-demo.py"""
import pathlib
root = pathlib.Path(__file__).resolve().parent.parent
html = (root / 'src' / 'index.html').read_text(encoding='utf-8')
mock = (root / 'demo' / 'demo-mock.js').read_text(encoding='utf-8')
banner = ('<div class="demo-banner">デモ版：表示されている会社名・数値・レポートはすべて架空のサンプルです。'
          'パスワードは何を入れてもログインできます。</div>')
html = html.replace('<title>Cc SNS Hub</title>', '<title>Cc SNS Hub デモ</title>')
html = html.replace('<base target="_top">', '<base target="_top">\n<script>\n' + mock + '\n</script>')
html = html.replace('</style>', '  .demo-banner{background:var(--accent-2);color:var(--accent);font-size:12px;padding:6px 16px;text-align:center}\n</style>', 1)
html = html.replace('<body>', '<body>\n' + banner, 1)
(root / 'demo' / 'index.html').write_text(html, encoding='utf-8')
print('wrote demo/index.html')
