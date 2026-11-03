from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
from scipy.ndimage import distance_transform_edt
import numpy as np
import math, colorsys, subprocess, zipfile, json, io

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'output'
OUT.mkdir(exist_ok=True)
for kind in ['base','phoenix']:
    (ROOT/f'frames_{kind}').mkdir(exist_ok=True)
N=50
SIZE=768
SOURCES={
 'base':'exec-2b0555fd-4167-48e2-b84d-91d9f18ff81c.png',
 'phoenix':'exec-e55871c5-4a78-4ac6-8ae1-7a69e15c772c.png'
}

def star(draw,x,y,r,color,angle=0):
    pts=[]
    for k in range(8):
        a=angle+k*math.pi/4
        rad=r if k%2==0 else r*.25
        pts.append((x+math.cos(a)*rad,y+math.sin(a)*rad))
    draw.polygon(pts,fill=color)

def render(kind,source):
    src=Image.open(source).convert('RGBA')
    # Keep the generated alpha. Only resample and animate this source artwork.
    src.thumbnail((560,560),Image.Resampling.LANCZOS)
    a=np.array(src)
    hsv=np.array(src.convert('RGB').convert('HSV'))
    h,w=a.shape[:2]
    yy,xx=np.mgrid[:h,:w]
    interior=distance_transform_edt(a[:,:,3]>100)
    arrow=(xx>w*.30)&(xx<w*.71)&(yy>h*.22)&(yy<h*.59)
    rim=(interior<9)&(yy>h*.24)
    mask=np.clip((hsv[:,:,1].astype(float)-20)/55,0,1)*np.clip((hsv[:,:,2].astype(float)-100)/60,0,1)*(arrow|rim)
    frames=[]
    for i in range(N):
        t=i/N
        beat=2*math.pi*4*t
        jump=(1-math.cos(beat))/2
        sway=math.sin(2*math.pi*2*t)
        shifted=hsv.copy()
        shifted[:,:,0]=((hsv[:,:,0].astype(float)+255*t)%256).astype('uint8')
        rgb=np.array(Image.fromarray(shifted,'HSV').convert('RGB'))
        cur=a.copy()
        cur[:,:,:3]=(a[:,:,:3]*(1-mask[:,:,None])+rgb*mask[:,:,None]).astype('uint8')
        sticker=Image.fromarray(cur,'RGBA')
        sx=1+.055*math.cos(beat)
        sy=1-.065*math.cos(beat)
        sticker=sticker.resize((round(w*sx),round(h*sy)),Image.Resampling.LANCZOS)
        sticker=sticker.rotate(4.5*sway,Image.Resampling.BICUBIC,expand=True)
        canvas=Image.new('RGBA',(SIZE,SIZE))
        cx=SIZE/2+9*sway
        bottom=SIZE-72-40*jump
        px=round(cx-sticker.width/2)
        py=round(bottom-sticker.height)
        # Gentle moving neon halo: no full-screen flash.
        halo=Image.new('RGBA',canvas.size)
        halo.alpha_composite(sticker,(px,py))
        halo=halo.filter(ImageFilter.GaussianBlur(9))
        ha=np.array(halo)
        ha[:,:,3]=(ha[:,:,3]*.24).astype('uint8')
        canvas=Image.alpha_composite(canvas,Image.fromarray(ha))
        canvas.alpha_composite(sticker,(px,py))
        sparkle=Image.new('RGBA',canvas.size)
        d=ImageDraw.Draw(sparkle)
        # Offset phases produce a travelling sparkle rhythm.
        points=[(-292,-115),(-270,55),(-250,205),(282,-145),(295,20),(263,180),(-210,-260),(230,-260)]
        for j,(dx,dy) in enumerate(points):
            phase=2*math.pi*(2*t+j/8)
            strength=.5+.5*math.sin(phase)
            r=8+14*strength
            col=tuple(round(c*255) for c in colorsys.hsv_to_rgb((t+j/8)%1,.72,1))
            x=cx+dx+4*math.cos(phase)
            y=SIZE*.54+dy-15*jump
            star(d,x,y,r,col+(round(145+100*strength),),.13*math.sin(phase))
            star(d,x,y,r*.35,(255,255,255,240))
        glow=sparkle.filter(ImageFilter.GaussianBlur(5))
        canvas=Image.alpha_composite(canvas,glow)
        canvas=Image.alpha_composite(canvas,sparkle)
        frames.append(canvas)
        buf=io.BytesIO()
        canvas.save(buf,format='PNG')
        dest=ROOT/f'frames_{kind}'/f'{i:03d}.png'
        dest.write_bytes(buf.getvalue())
        with Image.open(dest) as checked:
            checked.verify()
    # One stable palette for every frame avoids color-palette flicker.
    montage=Image.new('RGB',(256*5,256*2))
    for j,idx in enumerate(range(0,N,5)):
        rgb=Image.new('RGB',(SIZE,SIZE),(18,20,30))
        rgb.paste(frames[idx],mask=frames[idx].getchannel('A'))
        montage.paste(rgb.resize((256,256)),((j%5)*256,(j//5)*256))
    pal=montage.quantize(colors=255,method=Image.Quantize.MEDIANCUT)
    gifs=[]
    for fr in frames:
        q=fr.convert('RGB').quantize(palette=pal,dither=Image.Dither.FLOYDSTEINBERG)
        ix=np.array(q)
        ix[np.array(fr.getchannel('A'))<100]=255
        q=Image.fromarray(ix,'P')
        q.putpalette(pal.getpalette()[:765]+[0,0,0])
        gifs.append(q)
    gifs[0].save(OUT/f'H1gher_ACE_{kind}.gif',save_all=True,append_images=gifs[1:],duration=40,loop=0,transparency=255,disposal=2,optimize=False)
    subprocess.run(['ffmpeg','-y','-v','error','-framerate','25','-i',str(ROOT/f'frames_{kind}'/'%03d.png'),'-c:v','libvpx-vp9','-pix_fmt','yuva420p','-b:v','0','-crf','18','-cpu-used','4','-auto-alt-ref','0',str(OUT/f'H1gher_ACE_{kind}.webm')],check=True)
    # Export original alpha PNG frames for editors without alpha-WebM support.
    frames[0].save(OUT/f'H1gher_ACE_{kind}_still.png')
    return frames

allframes={k:render(k,ROOT.parent/'generated_images'/v) for k,v in SOURCES.items()}
# Internal QA storyboard over a dark background.
qa=Image.new('RGB',(4*384,2*384),(26,29,40))
for row,(kind,frames) in enumerate(allframes.items()):
    for col,idx in enumerate([0,6,13,19]):
        fr=frames[idx].resize((384,384))
        qa.paste(fr,(col*384,row*384),fr)
qa.save(ROOT/'qa_storyboard.jpg')
readme='''H1gher ACE celebration animation

ベース猫 / Phoenix風猫、各2秒・25fps・768×768。
GIFは無限ループ、背景透過。リズミカルなバウンス、左右スイング、着地時の伸縮、流れる虹色、星のきらめきを合成しています。音声なし。

GIFは半透明を保持できないため、柔らかい発光を使う動画編集にはアルファ付きWebMまたはPNG連番を推奨します。
WebMはVP9 + alpha。読み込みソフトが透過に非対応の場合は、PNG連番を25fpsで読み込んでください。
GIFは繰り返し再生します。WebM / PNG連番は編集ソフト側で2秒単位に複製してループさせてください。

frames_base / frames_phoenix：RGBA PNG連番000〜049。動画の最前面トラックに配置して縮小してください。
末尾に冒頭の重複フレームを入れず、連続ループできる周期で制作しています。
元画像：ImagegenでACE単体を制作。アニメーション：付属animate_ace.pyによるフレーム合成。
'''
(OUT/'README.txt').write_text(readme)
zip_buffer=io.BytesIO()
with zipfile.ZipFile(zip_buffer,'w',zipfile.ZIP_DEFLATED,allowZip64=False) as z:
    for p in OUT.iterdir():
        if p.suffix!='.zip': z.write(p,p.name)
    z.write(ROOT/'animate_ace.py','source/animate_ace.py')
    for k,f in SOURCES.items():
        z.write(ROOT.parent/'generated_images'/f,'generated_images/'+f)
        for p in (ROOT/f'frames_{k}').glob('*.png'): z.write(p,f'frames_{k}/'+p.name)
archive=OUT/'H1gher_ACE_animation_pack.zip'
archive.write_bytes(zip_buffer.getvalue())
with zipfile.ZipFile(archive) as checked:
    assert checked.testzip() is None
for p in OUT.iterdir(): print(p.name,p.stat().st_size)
