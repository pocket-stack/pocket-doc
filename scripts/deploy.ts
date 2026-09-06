import { randomBytes, createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const address = process.argv[2] ?? "172.20.12.37";
const binary = "dist/pocketdoc-main.3dsx";
const bytes = readFileSync(binary);
if (bytes.includes(Buffer.from("pocketjs-captures"))) throw new Error("Refusing to deploy a capture binary; rebuild without --capture");
mkdirSync(".local", { recursive: true });
if (!existsSync(".local/pair.key")) writeFileSync(".local/pair.key", randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" });
chmodSync(".local/pair.key", 0o600);
const manifest = await Bun.file("pocket.json").json();
const slot = createHash("sha256").update(manifest.id).digest("hex").slice(0, 16);
// Secrets remain files; neither command arguments nor receipts contain keys.
const program = `import ftplib, hashlib, io, json, pathlib, sys
ftp=ftplib.FTP(); ftp.connect(sys.argv[1],5000,timeout=20); ftp.login()
for path in ['/pocketjs','/pocketjs/offload']:
    try: ftp.mkd(path)
    except ftplib.error_perm as error:
        if not str(error).startswith('550'): raise
receipts=[]
for local,remote in [('.local/pair.key','/pocketjs/offload/'+sys.argv[2]+'.key'),('dist/pocketdoc-main.3dsx','/3DS/pocketdoc-main.3dsx')]:
    data=pathlib.Path(local).read_bytes()
    ftp.storbinary('STOR '+remote,io.BytesIO(data),blocksize=65536)
    result=io.BytesIO(); ftp.retrbinary('RETR '+remote,result.write)
    assert result.getvalue()==data, 'FTP readback mismatch'
    receipts.append({'path':remote,'bytes':len(data),'verified':True,**({'sha256':hashlib.sha256(data).hexdigest()} if local.endswith('.3dsx') else {})})
# Complete the one-time launcher rename only after the new image verifies.
# Archive the exact prior build; retain any unrecognized binary for inspection.
old='/3DS/pocketfolio-main.3dsx'
try:
    previous=io.BytesIO(); ftp.retrbinary('RETR '+old,previous.write)
except (ftplib.error_perm, ftplib.error_temp) as error:
    # ftpd uses 450 ENOENT for a removed launcher; do not swallow other 450 errors.
    if not str(error).startswith('550') and str(error) != '450 No such file or directory': raise
else:
    digest=hashlib.sha256(previous.getvalue()).hexdigest()
    expected='73d16cf762440e43fefd8824a249856f2ae9fbaaab9b1d958f57674e8b58243a'
    if digest != expected: raise RuntimeError('Pocket Doc installed; previous launcher differs from the known build and was retained')
    for directory in ['/pocketjs/migrations','/pocketjs/migrations/pocket-doc']:
        try: ftp.mkd(directory)
        except ftplib.error_perm as error:
            if not str(error).startswith('550'): raise
    archive='/pocketjs/migrations/pocket-doc/'+digest+'.3dsx'
    ftp.rename(old,archive)
    receipts.append({'migration':'previous launcher archived outside HBL','path':archive,'sha256':digest})
ftp.quit(); print(json.dumps(receipts,indent=2))
`;
const result = Bun.spawnSync(["python3", "-c", program, address, slot], { stdout: "pipe", stderr: "pipe" });
if (result.exitCode) throw new Error(result.stderr.toString());
console.log(result.stdout.toString());
await Bun.write("dist/qa/deploy.json", result.stdout);
