import json,subprocess
subprocess.run(['npx','esbuild','main.js','--bundle','--minify','--format=iife','--outfile=bundle.js'],check=True)
d=json.dumps(json.load(open('../work/data.json')),separators=(',',':'))
js=open('bundle.js').read().replace('</script','<\\/script')
V=[('Courtyard_Marriott_4D_Simulation.html','Courtyard by Marriott','logo.b64','Client','Leela Rise Private Limited','','<div class="pres">Presented by <b>Leela Rise Private Limited</b></div>'),
   ('Commercial_Sample_4D_Simulation.html','Commercial Sample','zlogo.b64','','Zenisth','plain','')]
for fn,title,logo,lbl,alt,cls,pres in V:
    t=open('template.html').read()
    for k,v in [('/*TITLE*/',title),('/*LOGOLBL*/',lbl),('/*LOGOALT*/',alt),('/*LOGOCLS*/',cls),('/*PRESENTED*/',pres)]: t=t.replace(k,v)
    t=t.replace('/*DATA*/',d).replace('/*LOGO*/',open('../work/'+logo).read()).replace('/*APP*/',js)
    open('../out/'+fn,'w').write(t); print(fn,len(t)/1e6)
