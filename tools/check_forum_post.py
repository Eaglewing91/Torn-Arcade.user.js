"""Check a forum post against the Torn HTML Handbook (tested 14/11/26): tags, CSS properties, where styles stick,
attributes, characters. python3 tools/check_forum_post.py docs/forum-post.html"""
import sys, re
from html.parser import HTMLParser
KEEP = set('p div br h1 h2 h3 h4 h5 h6 strong em i u s del sub sup code pre blockquote hr ul ol li table tr td th a img iframe details summary center span b strike'.split())
STYLE_OK_ON = set('div span p img h1 h2 h3 blockquote center a ul ol li table tr td th'.split())
CSS = set('''color background background-color background-image background-size background-repeat background-position font-size font-family
font-weight font-style font-variant text-align text-decoration text-transform text-indent line-height letter-spacing white-space vertical-align
border border-top border-right border-bottom border-left border-color border-width border-style border-radius border-collapse outline padding
padding-top padding-right padding-bottom padding-left margin margin-top margin-right margin-bottom margin-left width height min-width min-height
max-width max-height display justify-content align-items flex-wrap gap float overflow opacity visibility list-style-type'''.split())
DISPLAY = {'block', 'flex', 'grid', 'inline-block', 'none'}
ATTRS = {'*': {'style'}, 'a': {'href', 'title'}, 'img': {'src', 'alt', 'title', 'width', 'height', 'loading'}, 'td': {'colspan', 'rowspan', 'width'},
         'th': {'colspan', 'rowspan', 'width'}, 'table': {'width'}, 'iframe': {'src', 'width', 'height', 'frameborder'}}
problems = []
class P(HTMLParser):
    def handle_starttag(self, tag, attrs):
        ln = self.getpos()[0]; a = dict(attrs)
        if tag == 'embed': problems.append('%d: embed tag (Cloudflare blocks the save)' % ln)
        if tag not in KEEP: problems.append('%d: <%s> is removed or changed' % (ln, tag))
        if tag == 'caption': problems.append('%d: caption is removed with its text' % ln)
        for k in a:
            if k not in ATTRS['*'] and k not in ATTRS.get(tag, set()): problems.append('%d: %s %s= is removed' % (ln, tag, k))
        st = a.get('style')
        if st is not None and tag not in STYLE_OK_ON: problems.append('%d: style on <%s> does not stick' % (ln, tag))
        if tag == 'span' and not st: problems.append('%d: a span with no style is removed' % ln)
        if st:
            if re.search(r'hsl\(|calc\(|!important|var\(--(?!te-text-color)', st): problems.append('%d: rejected value in %r' % (ln, st))
            for decl in filter(None, (d.strip() for d in st.split(';'))):
                prop, _, val = decl.partition(':'); prop = prop.strip().lower(); val = val.strip()
                if prop not in CSS: problems.append('%d: CSS %s is dropped' % (ln, prop))
                if prop == 'display' and val not in DISPLAY: problems.append('%d: display:%s not allowed' % (ln, val))
        if tag == 'img' and not re.match(r'https?://', a.get('src', '')): problems.append('%d: image must be an http(s) URL' % ln)
        if tag == 'a' and re.match(r'\s*javascript:', a.get('href', ''), re.I): problems.append('%d: script link removed' % ln)
src = open(sys.argv[1], encoding='utf-8').read()
P().feed(src)
for i, line in enumerate(src.split('\n'), 1):
    bad = [c for c in line if ord(c) > 126]
    if bad: problems.append('%d: non-ASCII characters %r (emoji turn into ?)' % (i, ''.join(sorted(set(bad)))))
text = re.sub(r'<[^>]+>', '', src)
if re.search(r'&lt;\s*[a-z]+', text): problems.append('tag name typed as text')
print('\n'.join(problems) if problems else 'OK: %d characters, follows the handbook' % len(src))
