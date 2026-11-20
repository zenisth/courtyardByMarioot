import ifcopenshell, ifcopenshell.geom, ifcopenshell.util.element as ue, numpy as np, pickle, multiprocessing, sys
f=ifcopenshell.open('in/model.ifc')
s=ifcopenshell.geom.settings(); s.set('use-world-coords',True)
skip={'IfcOpeningElement','IfcAnnotation','IfcSite','IfcBuilding','IfcBuildingStorey','IfcBuildingElementProxy','IfcStair','IfcCurtainWall'}
elems=[e for e in f.by_type('IfcProduct') if e.is_a() not in skip and e.Representation]
it=ifcopenshell.geom.iterator(s,f,multiprocessing.cpu_count(),include=elems)
out=[]
if it.initialize():
    while True:
        sh=it.get(); e=f.by_id(sh.id)
        v=np.array(sh.geometry.verts,dtype=np.float32).reshape(-1,3)
        fa=np.array(sh.geometry.faces,dtype=np.uint32).reshape(-1,3)
        st=ue.get_container(e)
        if st is None and e.Decomposes: 
            p=e.Decomposes[0].RelatingObject; st=ue.get_container(p)
        out.append(dict(id=e.id(),guid=e.GlobalId,t=e.is_a(),name=(e.Name or ''),storey=st.Name if st else None,v=v,f=fa))
        if not it.next(): break
pickle.dump(out,open('work/geom.pkl','wb'))
print(len(out), sum(len(o['f']) for o in out),'tris', sum(len(o['v']) for o in out),'verts')
allv=np.concatenate([o['v'] for o in out]); print(allv.min(0),allv.max(0))
