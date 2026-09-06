#!/usr/bin/env python3
"""Fail-closed materializer for connector-delivered Git bundle artifacts."""
from __future__ import annotations
import argparse, hashlib, json, os, subprocess, tempfile, zipfile
from pathlib import Path
class MaterializationError(RuntimeError): pass
def _run(args, *, cwd=None):
    r=subprocess.run(args,cwd=str(cwd) if cwd else None,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=False)
    if r.returncode: raise MaterializationError(f"command failed ({' '.join(args)}): {(r.stderr or r.stdout).strip()}")
    return r
def _sha256(path):
    d=hashlib.sha256()
    with path.open('rb') as h:
        for c in iter(lambda:h.read(1024*1024),b''): d.update(c)
    return d.hexdigest()
def _safe_extract(archive,destination):
    with zipfile.ZipFile(archive) as zf:
        for m in zf.infolist():
            target=(destination/m.filename).resolve()
            if os.path.commonpath([destination.resolve(),target]) != str(destination.resolve()): raise MaterializationError(f"unsafe ZIP member: {m.filename}")
        zf.extractall(destination)
def _find_exact(root,name):
    m=[p for p in root.rglob(name) if p.is_file()]
    if len(m)!=1: raise MaterializationError(f"expected exactly one {name}, found {len(m)}")
    return m[0]
def _verify_checksum_file(path,bundle,actual):
    lines=[x.strip() for x in path.read_text(encoding='utf-8').splitlines() if x.strip()]
    if len(lines)!=1: raise MaterializationError('SHA256SUMS.txt must contain exactly one non-empty line')
    parts=lines[0].split()
    if len(parts)!=2 or parts[1].lstrip('*')!=bundle.name: raise MaterializationError('SHA256SUMS.txt has unexpected format or filename')
    if parts[0].lower()!=actual: raise MaterializationError('SHA256SUMS.txt hash mismatch')
def materialize(artifact_zip:Path,target:Path,source_sha:str,source_branch:str,remote_url:str|None=None):
    if not artifact_zip.is_file(): raise MaterializationError(f'artifact ZIP not found: {artifact_zip}')
    if target.exists() and any(target.iterdir()): raise MaterializationError(f'target already exists and is not empty: {target}')
    with tempfile.TemporaryDirectory(prefix='local-git-mirror-') as tmp:
        root=Path(tmp); extracted=root/'artifact'; extracted.mkdir(); _safe_extract(artifact_zip,extracted)
        bundle=_find_exact(extracted,'repository.bundle'); manifest_path=_find_exact(extracted,'manifest.json'); checksum=_find_exact(extracted,'SHA256SUMS.txt')
        try: manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
        except (json.JSONDecodeError,OSError) as e: raise MaterializationError(f'invalid manifest.json: {e}') from e
        if manifest.get('schema_version')!=1: raise MaterializationError('unsupported manifest schema_version')
        if manifest.get('source_sha')!=source_sha: raise MaterializationError('manifest source_sha does not match requested exact SHA')
        if manifest.get('source_branch')!=source_branch: raise MaterializationError('manifest source_branch does not match requested branch')
        if manifest.get('bundle_ref')!='refs/heads/local-mirror-source': raise MaterializationError('unexpected bundle_ref')
        actual=_sha256(bundle)
        if actual!=str(manifest.get('bundle_sha256','')).lower(): raise MaterializationError('bundle SHA-256 does not match manifest')
        if bundle.stat().st_size!=manifest.get('bundle_bytes'): raise MaterializationError('bundle size does not match manifest')
        _verify_checksum_file(checksum,bundle,actual)
        verify=root/'verify.git'; _run(['git','init','--bare','-q',str(verify)]); _run(['git','-C',str(verify),'bundle','verify',str(bundle)])
        target.mkdir(parents=True,exist_ok=True); _run(['git','init','-q',str(target)]); _run(['git','-C',str(target),'fetch','-q','--tags',str(bundle),'refs/heads/local-mirror-source:refs/remotes/local-mirror/source']); _run(['git','-C',str(target),'cat-file','-e',f'{source_sha}^{{commit}}']); _run(['git','-C',str(target),'checkout','-q','-B',source_branch,source_sha])
        if remote_url: _run(['git','-C',str(target),'remote','add','origin',remote_url])
        head=_run(['git','-C',str(target),'rev-parse','HEAD']).stdout.strip()
        if head!=source_sha: raise MaterializationError(f'final HEAD mismatch: expected {source_sha}, got {head}')
        _run(['git','-C',str(target),'fsck','--full','--no-dangling'])
        return {'status':'PASS','source_sha':source_sha,'source_branch':source_branch,'bundle_sha256':actual,'target':str(target.resolve()),'head':head,'fsck':'PASS','remote_url':remote_url}
def main():
    p=argparse.ArgumentParser(); p.add_argument('--artifact-zip',required=True,type=Path); p.add_argument('--target',required=True,type=Path); p.add_argument('--source-sha',required=True); p.add_argument('--source-branch',required=True); p.add_argument('--remote-url'); a=p.parse_args()
    try: print(json.dumps(materialize(a.artifact_zip,a.target,a.source_sha,a.source_branch,a.remote_url),ensure_ascii=False,sort_keys=True)); return 0
    except MaterializationError as e: print(json.dumps({'status':'FAIL','error':str(e)},ensure_ascii=False)); return 2
if __name__=='__main__': raise SystemExit(main())
