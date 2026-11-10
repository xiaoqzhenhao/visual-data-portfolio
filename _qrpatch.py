from pathlib import Path
p=Path(r'H:\面试\public-site\portfolio-slides.html'); s=p.read_text(encoding='utf-8')
needle='''    <div class="footer"><span>个人练习作品 · 合成数据/模拟预测已标注</span><span>07 / 07</span></div>'''
add='''    <img src="assets/media/qr-public.png" alt="扫码看作品集" style="position:absolute;right:64px;bottom:74px;width:104px;height:104px;border:5px solid #fff;border-radius:5px;z-index:5">
    <div style="position:absolute;right:64px;bottom:52px;width:114px;text-align:center;font-family:var(--mono);font-size:7px;color:#8fa0b3;z-index:5">SCAN / 作品集</div>
    <div style="margin-top:14px;font-family:var(--mono);font-size:10px;color:#8fa0b3;letter-spacing:.02em">xiaoqzhenhao.github.io/visual-data-portfolio</div>
'''+needle
assert needle in s, 'needle missing'
s=s.replace(needle,add,1)
p.write_text(s,encoding='utf-8'); print('ok',len(s))
