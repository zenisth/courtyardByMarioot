import pickle, numpy as np, json, gzip, base64, re, datetime as dt, openpyxl
g=pickle.load(open('work/geom.pkl','rb'))
D0=dt.datetime(2028,1,1)
def day(d): return (d-D0).days
# ---------- schedule ----------
wb=openpyxl.load_workbook('in/timeline.xlsx',data_only=True); ws=wb.active
fix={'Sitel leveling':'Site Leveling','Site  setup':'Site Setup','Basment-1':'Basement-1','Site Cleaning':'Site Cleaning'}
rows=[]
for r in ws.iter_rows(min_row=2,values_only=True):
    if not r[0]: continue
    rows.append(dict(raw=r[0].strip(),s=r[1],e=r[2],ms=r[5]==1))
acts=[];mas_s=mas_e=None
for r in rows:
    n=r['raw']
    if 'Masondary' in n:
        if 'Start' in n: mas_s=day(r['s'])
        else: mas_e=day(r['s'])
        continue
    acts.append(dict(name=fix.get(n,n),s=day(r['s']),e=day(r['e']),ms=r['ms']))
A={a['name']:a for a in acts}
# ---------- storeys ----------
ST=['BASMENT','GROUND FLOOR','1 st FLOOR','2 nd FLOOR','3 rd FLOOR','4 th FLOOR','5 th FLOOR','6 th FLOOR','7 th FLOOR','8 th FLOOR','9 th FLOOR','10 th FLOOR','TERRACE FLOOR']
SHORT=['B1','GF','1','2','3','4','5','6','7','8','9','10','T']
LEV=[-4.5,0,5.5,10.5,15.1,18.45,21.8,25.15,28.5,31.85,35.2,38.55,41.9]
floorAct={1:'Ground Floor',2:'1st Floor',3:'2nd Floor',4:'3rd Floor',5:'4th Floor',6:'5th Floor',7:'6th Floor',8:'7th Floor',9:'8th Floor',10:'9th Floor',11:'10th Floor',12:'Terrace'}
# structural activity per storey index (columns of storey i, slab of storey i+1)
colAct={0:'Basement-1'}; colAct.update({i:floorAct[i] for i in range(1,13)})
slabAct={1:'Basement-1'}; slabAct.update({i:floorAct[i-1] for i in range(2,13)})
# masonry windows (storeys 0..11), terrace walls belong to Terrace activity
ceilEnd={i:A[slabAct[i+1]]['e'] for i in range(12)}
mas={}
step=(mas_e-mas_s-30)/11
for i in range(12):
    s=max(round(mas_s+i*step), ceilEnd[i]+1); e=min(s+30,mas_e)
    if e-s<5: s=e-5
    mas[i]=(s,e)
pl=A['Plaster']; plast={}
for k,i in enumerate(range(11,-1,-1)): plast[i]=pl['s']+k*(pl['e']-pl['s']-2)/11
# ---------- transform ----------
CX,CY=132.7,-5.0
def T(v): return np.stack([v[:,0]-CX, v[:,2], -(v[:,1]-CY)],1).astype(np.float32)
def typ(o): return re.sub(r':\d+$','',o['name'])
els=[]; ground=None
for o in g:
    if o['name'].startswith('Floor:Concrete 250mm:1917496'): ground=o; continue
    els.append(o)
for o in els: o['V']=T(o['v']); o['si']=ST.index(o['storey'])
CAT={'conc':0,'mas':1,'glass':2}
def isStair(o): return o['t'] in('IfcStairFlight','IfcRamp') or 'Stair' in o['name']
groups={}
def add(key,o,cat,role): o['act']=key;o['cat']=cat;o['role']=role; groups.setdefault(key,[]).append(o)
for o in els:
    si=o['si'];n=o['name'];t=o['t']
    if si==0 and t=='IfcSlab' and ('Footing' in n or 'Foundation' in n):
        add('PCC/Foundation',o,0,'pcc' if '150mm' in n else ('foot' if 'Footing' in n else 'raft'))
    elif 'Retaining' in n: add('Retaining Wall',o,0,'wall')
    elif t=='IfcColumn': add(colAct[si],o,0,'col')
    elif isStair(o): add(colAct[si],o,0,'stair')
    elif t=='IfcSlab': add(slabAct[si],o,0,'slab')
    elif t in('IfcWallStandardCase','IfcWall','IfcPlate'):
        cat=2 if t=='IfcPlate' else 1
        if si==12: add('Terrace',o,cat,'twall')
        else: add('MAS%d'%si,o,cat,'mw' if cat==1 else 'gl')
    else: print('unassigned',t,n)
# ---------- timing within activity ----------
def window(key):
    if key.startswith('MAS'): return mas[int(key[3:])]
    return A[key]['s'],A[key]['e']
pours=[]
for key,L in groups.items():
    s,e=window(key); D=e-s
    def stagger(lst,a,b,sortkey,dur=0.25):
        lst=sorted(lst,key=sortkey); n=len(lst)
        for k,o in enumerate(lst):
            f=k/max(n,1)*(1-dur)
            o['t0']=s+D*(a+(b-a)*f); o['t1']=s+D*(a+(b-a)*(f+dur))
    cx=lambda o:float(o['V'][:,0].mean())
    if key=='PCC/Foundation':
        stagger([o for o in L if o['role']=='pcc'],0,.25,cx,1)
        stagger([o for o in L if o['role']=='foot'],.2,.6,cx,.2)
        stagger([o for o in L if o['role']=='raft'],.55,1,cx,1)
        pours.append((s,e,key))
    elif key=='Retaining Wall':
        stagger(L,0,1,cx,.3); pours.append((s,e,key))
    elif key.startswith('MAS'):
        stagger([o for o in L if o['cat']==1],0,.85,cx,.25)
        stagger([o for o in L if o['cat']==2],.6,1,cx,.3)
    elif key=='Terrace':
        stagger([o for o in L if o['role']=='col'],0,.4,cx,.3)
        stagger([o for o in L if o['role']!='col'],.35,1,cx,.25)
    else:
        stagger([o for o in L if o['role']=='col'],0,.45,cx,.25)
        stagger([o for o in L if o['role']=='stair'],.3,.7,cx,.4)
        sl=[o for o in L if o['role']=='slab']
        stagger(sl,.45,1,lambda o:-float(o['V'][:,2].mean()),.7 if len(sl)>1 else 1)
        if sl: pours.append((s+D*.45,e,key))
# reveal axis: 0=Y vertical,1=Z(sweep),2=X
for o in els:
    V=o['V']; mn=V.min(0); mx=V.max(0)
    if o['role'] in('slab','raft','pcc'): ax=1; lo,hi=mx[2],mn[2]   # sweep north (−Z) ... handled sign in shader via lo>hi
    else: ax=0; lo,hi=mn[1],mx[1]
    o['ax']=ax;o['lo']=float(lo);o['hi']=float(hi)
    o['pt']=float(plast[o['si']]) if o['cat']==1 and o['si']<12 else -1
# ---------- geometry buffers ----------
tri=[];triE=[];edg=[];edgE=[]
for idx,o in enumerate(els):
    V=o['V'];F=o['f'].astype(np.int64)
    tri.append(V[F].reshape(-1,9)); triE.append(np.full(len(F),idx,np.uint16))
    # feature edges
    P=V[F]; nrm=np.cross(P[:,1]-P[:,0],P[:,2]-P[:,0]); nl=np.linalg.norm(nrm,axis=1,keepdims=True); nrm=nrm/np.maximum(nl,1e-9)
    # weld verts by position
    key=np.round(V*200).astype(np.int64); _,inv=np.unique(key,axis=0,return_inverse=True); inv=inv.reshape(-1); Fw=inv[F]
    em={}
    for fi,(a,b,c) in enumerate(Fw):
        for u,w in((a,b),(b,c),(c,a)):
            k=(min(u,w),max(u,w)); em.setdefault(k,[]).append(fi)
    rep={}; 
    for vi,w in enumerate(inv): rep.setdefault(w,vi)
    segs=[]
    for (u,w),fs in em.items():
        if u==w: continue
        if len(fs)==1 or (len(fs)==2 and abs(np.dot(nrm[fs[0]],nrm[fs[1]]))<0.9):
            segs.append(np.concatenate([V[rep[u]],V[rep[w]]]))
    if segs: edg.append(np.array(segs,np.float32)); edgE.append(np.full(len(segs),idx,np.uint16))
tri=np.concatenate(tri).astype(np.float32); triE=np.concatenate(triE); edg=np.concatenate(edg); edgE=np.concatenate(edgE)
# ground: top faces
GV=T(ground['v']);GF=ground['f'].astype(np.int64);top=GV[GF][:,:,1].min(1)>-0.01
gtri=GV[GF[top]].reshape(-1,9).astype(np.float32); gtri[:,1::3]=-0.02
print('tris',len(tri),'edges',len(edg),'ground',len(gtri))
blob=tri.tobytes()+triE.tobytes()+edg.tobytes()+edgE.tobytes()+gtri.tobytes()
b64=base64.b64encode(gzip.compress(blob,9)).decode()
print('gz b64 MB',len(b64)/1e6)
E=[[o['act'] if not o['act'].startswith('MAS') else 'Masonry Work',o['cat'],round(o['t0'],2),round(o['t1'],2),o['ax'],round(o['lo'],2),round(o['hi'],2),round(o['pt'],2),o['si']] for o in els]
# pour targets
def centroid(key):
    L=[o for o in groups[key] if o['role'] in('slab','raft','pcc','wall')]
    V=np.concatenate([o['V'] for o in L]); return [float(V[:,0].mean()),float(V[:,1].max()),float(V[:,2].mean())]
P=[[s,e,k,centroid(k)] for s,e,k in pours]
lift=[128.7-CX,-(-15.0-CY)]
pit=[92.9-CX,-(48.9-CY),172.5-CX,-(-59.0-CY)]
rows_out=[]
for a in acts:
    rows_out.append(a)
    if a['name']=='Terrace':
        rows_out.append(dict(name='Masonry Work',s=mas_s,e=mas_e,ms=False,segs=[mas[i] for i in range(12)]))
meta=dict(start='2028-01-01',acts=rows_out,mas={str(k):v for k,v in mas.items()},storeys=SHORT,lev=LEV,colAct=colAct,slabAct=slabAct,
 counts=dict(tri=len(tri),edg=len(edg),gnd=len(gtri)),pours=P,lift=lift,pit=pit,elements=E,plaster=[pl['s'],pl['e']])
json.dump(dict(meta=meta,b64=b64),open('work/data.json','w'))
for a in rows_out: print(a['name'],a['s'],a['e'],a['ms'])
print({k:len(v) for k,v in groups.items()})
