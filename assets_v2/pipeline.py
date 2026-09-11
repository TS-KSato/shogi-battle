
import bpy, os, struct, json, gzip, math
OUT = r"C:\Users\SATO\Downloads\shogi-assets\v2"
SRC = r"C:\Users\SATO\Downloads\shogi-assets"
TARGET_TRIS = 6000
def _bounds(o):
    dg=bpy.context.evaluated_depsgraph_get(); e=o.evaluated_get(dg); m=e.matrix_world
    xs=[];ys=[];zs=[]
    for v in e.data.vertices:
        w=m@v.co; xs.append(w.x); ys.append(w.y); zs.append(w.z)
    return (min(xs),max(xs),min(ys),max(ys),min(zs),max(zs))
def import_body(code):
    """FBX を取り込み、armature を <Code>Arm_v2、mesh を <code>_v2 に改名して返す"""
    before=set(o.name for o in bpy.data.objects); bimg=set(i.name for i in bpy.data.images)
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.import_scene.fbx(filepath=os.path.join(SRC, code+"_Idle.fbx"), use_anim=True, ignore_leaf_bones=True)
    new=[o for o in bpy.data.objects if o.name not in before]
    arm=[o for o in new if o.type=='ARMATURE'][0]; mesh=[o for o in new if o.type=='MESH']
    assert len(mesh)==1, [o.name for o in mesh]
    ob=mesh[0]; arm.name=code+"_arm_v2"; ob.name=code+"_v2"; ob.data.name=code+"_v2_mesh"
    imgs=[i for i in bpy.data.images if i.name not in bimg]
    ob.data.calc_loop_triangles()
    acts=[a.name for a in bpy.data.actions if arm.animation_data and a==arm.animation_data.action]
    return {"arm":arm.name,"mesh":ob.name,"tris":len(ob.data.loop_triangles),"bones":len(arm.data.bones),
            "images":[(i.name,i.size[:]) for i in imgs],"action":acts,"frames":[int(x) for x in arm.animation_data.action.frame_range]}
def decimate(code, n=TARGET_TRIS):
    ob=bpy.data.objects[code+"_v2"]; ob.data.calc_loop_triangles(); t=len(ob.data.loop_triangles)
    if t>n:
        bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active=ob
        m=ob.modifiers.new("dec",'DECIMATE'); m.ratio=n/t; bpy.ops.object.modifier_apply(modifier="dec")
    ob.data.calc_loop_triangles(); return {"before":t,"after":len(ob.data.loop_triangles),"vgroups":len(ob.vertex_groups)}
def texture256(code, size=256):
    ob=bpy.data.objects[code+"_v2"]; mat=ob.data.materials[0]
    node=[n for n in mat.node_tree.nodes if n.type=='TEX_IMAGE'][0]; base=node.image
    tmp=base.copy(); tmp.scale(size,size)
    new=bpy.data.images.new(code+f"_{size}",size,size); buf=[0.0]*(size*size*4); tmp.pixels.foreach_get(buf); new.pixels.foreach_set(buf)
    p=os.path.join(SRC,"_tex",code+f"_{size}.jpg"); new.filepath_raw=p; new.file_format='JPEG'; bpy.context.scene.render.image_settings.quality=90; new.save()
    bpy.data.images.remove(tmp); new.reload(); node.image=new
    mat.name=code+"_mat_v2"
    return {"src":base.size[:],"now":new.size[:],"file":os.path.getsize(p)}
def normalize(code, body_name=None):
    """静止全高 0.7026、アニメ全体の最低点 z=0、水平は動きの範囲の中央。body_name を指定すると中心はそれで取る"""
    sc=bpy.context.scene; arm=bpy.data.objects[code+"_arm_v2"]; ob=bpy.data.objects[body_name or code+"_v2"]
    act=arm.animation_data.action; f0,f1=int(act.frame_range[0]),int(act.frame_range[1])
    arm.data.pose_position='REST'; arm.location=(0,0,0); sc.frame_set(f0); bpy.context.view_layer.update()
    r=_bounds(ob); s=arm.scale[0]*0.7026/(r[5]-r[4]); arm.scale=(s,s,s); bpy.context.view_layer.update()
    arm.data.pose_position='POSE'; bpy.context.view_layer.update()
    zmin=1e9; xs=[]; ys=[]
    for f in range(f0,f1+1,2):
        sc.frame_set(f); bpy.context.view_layer.update(); b=_bounds(ob); zmin=min(zmin,b[4]); xs.append((b[0]+b[1])/2); ys.append((b[2]+b[3])/2)
    arm.location=(-(min(xs)+max(xs))/2, -(min(ys)+max(ys))/2, -zmin); bpy.context.view_layer.update()
    arm.data.pose_position='REST'; sc.frame_set(f0); bpy.context.view_layer.update(); r2=_bounds(ob)
    arm.data.pose_position='POSE'; bpy.context.view_layer.update()
    zmin2=1e9; xs2=[]; ys2=[]
    for f in range(f0,f1+1,2):
        sc.frame_set(f); bpy.context.view_layer.update(); b=_bounds(ob); zmin2=min(zmin2,b[4]); xs2.append((b[0]+b[1])/2); ys2.append((b[2]+b[3])/2)
    sc.frame_set(f0)
    return {"scale":round(s,6),"rest_height":round(r2[5]-r2[4],4),"anim_zmin":round(zmin2,5),
            "cx":(round(min(xs2),3),round(max(xs2),3)),"cy":(round(min(ys2),3),round(max(ys2),3)),"rest_cy":round((r2[2]+r2[3])/2,3)}
def export(code, outname=None, extra=()):
    sc=bpy.context.scene; arm=bpy.data.objects[code+"_arm_v2"]; ob=bpy.data.objects[code+"_v2"]
    act=arm.animation_data.action; sc.frame_start,sc.frame_end=int(act.frame_range[0]),int(act.frame_range[1])
    for x in bpy.data.objects: x.hide_set(False)
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); arm.select_set(True)
    for e in extra: bpy.data.objects[e].select_set(True)
    bpy.context.view_layer.objects.active=arm
    p=os.path.join(OUT,(outname or code+"_idle")+".glb")
    bpy.ops.export_scene.gltf(filepath=p, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
        export_skins=True, export_animations=True, export_image_format='JPEG', export_frame_range=True, export_animation_mode='ACTIVE_ACTIONS')
    return verify(p)
def verify(p):
    d=open(p,'rb').read(); ln=struct.unpack('<I',d[12:16])[0]; j=json.loads(d[20:20+ln])
    off=20+ln; bln=struct.unpack('<I',d[off:off+4])[0]; bin_=d[off+8:off+8+bln]
    tris=sum(j["accessors"][pr["indices"]]["count"]//3 for m in j["meshes"] for pr in m["primitives"])
    imgs=[]
    for im in j.get("images",[]):
        bv=j["bufferViews"][im["bufferView"]]; b=bin_[bv["byteOffset"]:bv["byteOffset"]+bv["byteLength"]]
        i=2; w=h=None
        while i<len(b):
            if b[i]!=0xFF: i+=1; continue
            mk=b[i+1]
            if mk in (0xC0,0xC1,0xC2): h=struct.unpack('>H',b[i+5:i+7])[0]; w=struct.unpack('>H',b[i+7:i+9])[0]; break
            i+=2+struct.unpack('>H',b[i+2:i+4])[0]
        imgs.append((w,h,bv["byteLength"]))
    tmax=max([j["accessors"][s["input"]]["max"][0] for a in j.get("animations",[]) for s in a["samplers"]] or [0])
    return {"file":os.path.basename(p),"bytes":len(d),"gzip":len(gzip.compress(d,9)),"tris":tris,"joints":[len(s["joints"]) for s in j.get("skins",[])],
            "animations":len(j.get("animations",[])),"anim_sec":round(tmax,2),"images":imgs,
            "baseColorFactor":[m.get("pbrMetallicRoughness",{}).get("baseColorFactor") for m in j["materials"]],"materials":[m.get("name") for m in j["materials"]]}
def show_only(names, frame):
    for x in bpy.data.objects: x.hide_set(x.name not in names)
    bpy.context.scene.frame_set(frame); bpy.context.view_layer.update()
    for a in bpy.context.screen.areas:
        if a.type=='VIEW_3D':
            sp=a.spaces[0]; sp.shading.type='SOLID'; sp.shading.color_type='TEXTURE'; sp.overlay.show_overlays=False
            with bpy.context.temp_override(area=a, region=[x for x in a.regions if x.type=='WINDOW'][0]):
                bpy.ops.object.select_all(action='DESELECT')
                for n in names: bpy.data.objects[n].select_set(True)
                bpy.ops.view3d.view_selected(); bpy.ops.object.select_all(action='DESELECT')
            break

import bmesh, mathutils
def transfer_parts(old_mesh, old_arm, code, body_mats, part_mats):
    """旧メッシュの part_mats の面を、骨相対で新メッシュ <code>_v2 に写す。頂点重みは同名グループへ。"""
    sc=bpy.context.scene
    oo=bpy.data.objects[old_mesh]; oa=bpy.data.objects[old_arm]; no=bpy.data.objects[code+"_v2"]; na=bpy.data.objects[code+"_arm_v2"]
    oa.data.pose_position='REST'; na.data.pose_position='REST'; bpy.context.view_layer.update()
    ome=oo.data; nme=no.data
    ob_w=oo.matrix_world; nb_w_inv=no.matrix_world.inverted()
    oldB={b.name:(oa.matrix_world@b.matrix_local) for b in oa.data.bones}
    newB={b.name:(na.matrix_world@b.matrix_local) for b in na.data.bones}
    gnames=[g.name for g in oo.vertex_groups]
    # 対象の面
    sel=[p for p in ome.polygons if ome.materials[p.material_index].name in part_mats]
    body_faces=sum(1 for p in ome.polygons if ome.materials[p.material_index].name in body_mats)
    assert body_faces+len(sel)==len(ome.polygons), (body_faces,len(sel),len(ome.polygons))
    vids=sorted(set(v for p in sel for v in p.vertices))
    # 骨相対で座標変換
    newco={}; dom={}; missing=set()
    for vi in vids:
        v=ome.vertices[vi]
        if not v.groups: missing.add(vi); continue
        g=max(v.groups,key=lambda x:x.weight); bn=gnames[g.group]
        if bn not in newB: missing.add(bn); continue
        w=ob_w@v.co
        newco[vi]=nb_w_inv@(newB[bn]@oldB[bn].inverted()@w); dom[vi]=(bn,g.weight)
    assert not missing, missing
    # 新メッシュへ追加
    bm=bmesh.new(); bm.from_mesh(nme)
    uvl=bm.loops.layers.uv.verify(); dl=bm.verts.layers.deform.verify()
    ouv=ome.uv_layers.active.data if ome.uv_layers.active else None
    # マテリアル
    for mn in part_mats:
        if bpy.data.materials[mn].name not in [m.name for m in nme.materials]: nme.materials.append(bpy.data.materials[mn])
    matidx={m.name:i for i,m in enumerate(nme.materials)}
    # 頂点グループ（名前で対応）
    for vi in vids:
        for g in ome.vertices[vi].groups:
            gn=gnames[g.group]
            if gn not in no.vertex_groups: no.vertex_groups.new(name=gn)
    gidx={g.name:g.index for g in no.vertex_groups}
    vmap={}
    for vi in vids:
        nv=bm.verts.new(newco[vi]); vmap[vi]=nv
        for g in ome.vertices[vi].groups: nv[dl][gidx[gnames[g.group]]]=g.weight
    bm.verts.ensure_lookup_table()
    added=0
    for p in sel:
        try: nf=bm.faces.new([vmap[v] for v in p.vertices])
        except ValueError: continue
        nf.material_index=matidx[ome.materials[p.material_index].name]; nf.smooth=p.use_smooth
        if ouv:
            for k,lp in enumerate(nf.loops): lp[uvl].uv=ouv[p.loop_start+k].uv
        added+=1
    bm.to_mesh(nme); bm.free(); nme.update(); nme.calc_loop_triangles()
    oa.data.pose_position='POSE'; na.data.pose_position='POSE'; bpy.context.view_layer.update()
    return {"part_faces":len(sel),"added":added,"verts":len(vids),"total_tris":len(nme.loop_triangles),"bones_used":sorted(set(b for b,_ in dom.values())),"vg":len(no.vertex_groups)}
