// Run the compiled guest in QuickJS, with a stricter 128 KiB stack than the
// 3DS host's 192 KiB. Host operations are stubs: this checks JS execution and
// resource transitions, while scripts/sim.ts and native captures check pixels.
let node = 3, texture = 1, session = -1, ticks = 0, failures = false, libraryTotal = 1000;
const replies = [];
const mask = "A".repeat(1366) + "==";
const document = {id:1, title:"Stack smoke", revision:"revision-1", layout:"layout-1", rows:1000,
  chars:10000, mini:[10,20], outline:[], links:[]};
globalThis.ui = {__host:"3ds-dev", __hostAbi:8, __viewport:{w:400,h:240},
  __auxiliarySurface:{root:2,w:320,h:240}, __textures:{"shift.svg":0,"shift-lock.svg":2,"doc-book.svg":1}, __sprites:{},
  createNode:() => node++, measureText:text => text.length * 7};
for (const name of ["destroyNode","insertBefore","removeChild","setStyle","setProp","setPropBatch",
  "setText","replaceText","uploadTexture","setImage","setSprite","animate","cancelAnim","setFocus",
  "setActive","hitTest","hitTestBounds","hitTestAuxiliary","hitTestBoundsAuxiliary","setCursor",
  "setCursorPos","loadStyles","loadFontAtlas","loadTileTexture","freeTexture","uploadImgEntry",
  "debugInspect","debugRectXY","debugRectWH","debugPause","debugStep","debugStats",
  "__dbgActive","__dbgPoll","__dbgSend","__dbgShot"]) ui[name] = () => 0;
globalThis.offload = {
  session:() => session, take:() => replies.shift(), uploadCoverage:() => texture++,
  submit(raw) {
    const request = JSON.parse(raw), p = JSON.parse(request.payload);
    let value;
    switch (request.method) {
      case "library.list": value = {total:libraryTotal, rows:Array.from({length:Math.min(12, Math.max(0, libraryTotal-p.offset))}, (_,i) => ({id:p.offset+i+1,title:"Note "+(p.offset+i+1),bytes:110000}))}; break;
      case "document.open": value = document; break;
      case "document.window": value = Array.from({length:12}, (_,i) => ({row:p.first+i,kind:4,columns:[128,128],header:i===0})); break;
      case "document.tile":
        if (failures) { replies.push(JSON.stringify({id:request.id,error:"smoke unavailable"})); return true; }
        value = {mask,kind:4,start:p.row*10}; break;
      case "text.tile": value = {mask}; break;
      case "document.stat": value = {id:p.id,title:"new.md",revision:document.revision}; break;
      case "document.remove": libraryTotal--; value = {id:p.id,removed:true}; break;
      case "document.create": libraryTotal=1001; value = {document:{...document,id:1001,title:p.name},position:1000,total:1001,window:{token:"draft-created",seq:0,start:0,end:6,text:"# new\n",revision:document.revision,first:0,totalRows:2,chars:6,stagedDirty:false,undo:0,redo:0}}; break;
      case "draft.discard": value = {discarded:true}; break;
      case "draft.begin": value = {token:"draft-smoke",seq:0,start:0,end:12,text:"hello world\n",revision:document.revision,first:0,totalRows:2,chars:12,stagedDirty:false,undo:0,redo:0}; break;
      default: throw new Error("Unexpected smoke capability: "+request.method);
    }
    replies.push(JSON.stringify({id:request.id,payload:JSON.stringify(value)})); return true;
  },
};
globalThis.__simHz = 60;
function frames(n, buttons=0, analog=0x8080) {
  for (let i=0;i<n;i++) { frame(buttons,analog,[],[],[]); ticks++; }
}
function check(condition, message) { if (!condition) throw new Error(message); }
try {
  std.loadScript(scriptArgs[1] || "runtime/dist/3ds/guest/pocketdoc-main.js");
  const s = globalThis.__doc;
  frames(60); check(s.mode()==="read", "offline mount failed");
  session=1; frames(100); s.setFocus("document"); frames(60,0,0x80ff); frames(60,0,0x8000);
  check(s.total()===1000 && s.tiles.size>=24, "resource reveal failed");
  failures=true; s.jump(0.5,"document"); frames(100);
  const row = Math.floor(s.scroll.offset()/20);
  check(s.rowResource(row).status==="error", "resource error fallback not exercised");
  failures=false; frames(140);
  check(s.rowResource(row).status==="ready", "resource retry failed");
  frames(1,0x0200); frames(1,0x0200|0x0040); frames(1,0x0200); frames(1,0x0200|0x2000); frames(40);
  check(s.mode()==="edit" && s.caret()===0, "editor chord leaked a plain A press");
  s.key("中"); frames(20);
  check(s.dirty() && s.textTiles.size>0, "Unicode source resource failed");
  const draft=s.draft().text; session=-1; frames(20);
  s.perform("discard"); frames(1); check(s.confirmDiscard(), "discard sheet missing");
  s.cancelDiscard(); frames(14); check(s.draft().text===draft, "cancel discarded the draft");
  check(s.draft().text===draft, "offline draft lost");
  session=2; frames(30); s.perform("discard"); frames(14); s.discard(); frames(40);
  s.perform("new"); frames(1); check(s.mode()==="create", "filename dialog missing");
  s.key("new"); s.createDocument(); frames(30);
  check(s.mode()==="edit" && s.doc().id===1001, "create did not enter editor");
  s.perform("delete"); frames(20); check(s.deleteTarget(), "delete confirmation missing");
  frames(1,0x4000); frames(14); check(!s.deleteTarget(), "B did not cancel delete");
  s.perform("delete"); frames(20); s.removeDocument(); frames(50);
  check(!s.deleteTarget() && libraryTotal===1000 && s.doc().id!==1001, "delete did not refresh the editor");
  std.puts(JSON.stringify({ok:true,frames:ticks,nativeNodeIds:node,uploadedTextures:texture,
    checks:["offline mount","continuous stick scrolling","table reveal","error fallback","retry","editor","Unicode resource","discard cancellation","offline draft","filename dialog","create-to-editor","delete confirmation","delete cancellation","delete refresh"]})+"\n");
} catch (error) { std.puts(String(error)+"\n"+error.stack+"\n"); std.exit(1); }
