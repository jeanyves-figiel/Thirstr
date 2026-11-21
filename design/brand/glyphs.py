# Outlines Bricolage Grotesque 800 glyphs to SVG paths for design/brand (needs fonttools + brotli).
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
import json,sys
import os
HERE=os.path.dirname(os.path.abspath(__file__))
f=TTFont(os.path.join(HERE,'../../web/site/fonts/bricolage-grotesque-latin-800-normal.woff2'))
upm=f['head'].unitsPerEm; gs=f.getGlyphSet(); cmap=f.getBestCmap()
out={'upm':upm}
for ch in 'thirsr':
    g=cmap[ord(ch)]; pen=SVGPathPen(gs)
    gs[g].draw(TransformPen(pen,(1,0,0,-1,0,0)))  # flip y; baseline at 0
    out[ch]={'d':pen.getCommands(),'adv':gs[g].width}
json.dump(out,open(os.path.join(HERE,'glyphs.json'),'w'))
print(upm,{k:v['adv'] for k,v in out.items() if k!='upm'})
