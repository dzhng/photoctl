#!/usr/bin/env python3
"""Measure the committed ARW without importing any photoctl code."""
import hashlib, json, pathlib, re, struct, sys
path = pathlib.Path(sys.argv[1] if len(sys.argv)>1 else "fixtures/a7c2.ARW")
data = path.read_bytes()
def jpeg_dimensions(blob):
    pos=2
    while pos+4 < len(blob):
        if blob[pos] != 0xff: pos += 1; continue
        marker=blob[pos+1]; pos += 2
        if marker in (0xd8,0xd9) or 0xd0 <= marker <= 0xd7: continue
        length=int.from_bytes(blob[pos:pos+2],"big")
        if marker in range(0xc0,0xc4): return int.from_bytes(blob[pos+5:pos+7],"big"),int.from_bytes(blob[pos+3:pos+5],"big")
        pos += length
    raise ValueError("JPEG dimensions not found")
previews=[]
for match in re.finditer(b"\\xff\\xd8\\xff",data):
    end=data.find(b"\\xff\\xd9",match.start()+3)
    if end<0: continue
    end += 2
    try: width,height=jpeg_dimensions(data[match.start():end])
    except ValueError: continue
    item={"width":width,"height":height,"offset":match.start(),"length":end-match.start()}
    if item not in previews: previews.append(item)
endian = "<" if data[:2] == b"II" else ">"
u16=lambda offset: struct.unpack_from(endian+"H",data,offset)[0]
u32=lambda offset: struct.unpack_from(endian+"I",data,offset)[0]
queue=[u32(4)]; seen=set()
while queue:
    ifd=queue.pop()
    if ifd in seen or ifd+2 > len(data): continue
    seen.add(ifd); entries={}
    count=u16(ifd)
    for index in range(count):
        entry=ifd+2+index*12
        if entry+12 > len(data): break
        tag,kind,nvalues=u16(entry),u16(entry+2),u32(entry+4)
        value=u32(entry+8)
        entries[tag]=(kind,nvalues,value)
        if tag in (0x14a,0x8769):
            offsets=[value] if nvalues == 1 else [u32(value+i*4) for i in range(nvalues)]
            queue.extend(offsets)
    if 0x201 in entries and 0x202 in entries:
        offset,length=entries[0x201][2],entries[0x202][2]
        try: width,height=jpeg_dimensions(data[offset:offset+length])
        except ValueError: pass
        else: previews.append({"width":width,"height":height,"offset":offset,"length":length})
    next_at=ifd+2+count*12
    if next_at+4 <= len(data) and u32(next_at): queue.append(u32(next_at))
wanted={(160,120),(1616,1080),(7008,4672)}
previews=[p for p in previews if (p["width"],p["height"]) in wanted]
previews.sort(key=lambda p:p["width"]*p["height"])
size=len(data); packed=struct.pack("<Q",size); meg=1024*1024
content_key="ck_"+hashlib.sha256(packed+data[:meg]+data[-meg:]).hexdigest()[:16]
def find_ascii(pattern):
    found=re.search(pattern,data)
    if not found: raise ValueError(f"metadata not found: {pattern!r}")
    return found.group().decode("ascii")
manifest={"file":path.name,"size":size,"sha256":hashlib.sha256(data).hexdigest(),"content_key":content_key,"previews":previews,"exif":{"DateTimeOriginal":find_ascii(rb"20\d\d:\d\d:\d\d \d\d:\d\d:\d\d"),"OffsetTimeOriginal":find_ascii(rb"[+-]\d\d:\d\d")}}
out=path.with_suffix(".json"); out.write_text(json.dumps(manifest,indent=2)+"\n")
print(out)
