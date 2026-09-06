import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('materialize_bundle',ROOT/'tools'/'local-git-mirror'/'materialize_bundle.py'); mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
def run(*args): return subprocess.run(args,check=True,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
def artifact(root,checksum=None):
    repo=root/'src'; repo.mkdir(); run('git','init','-q',str(repo)); run('git','-C',str(repo),'config','user.email','test@example.invalid'); run('git','-C',str(repo),'config','user.name','Mirror Test'); (repo/'x').write_text('x'); run('git','-C',str(repo),'add','x'); run('git','-C',str(repo),'commit','-q','-m','seed'); sha=run('git','-C',str(repo),'rev-parse','HEAD').stdout.strip(); run('git','-C',str(repo),'branch','local-mirror-source',sha)
    d=root/'a'; d.mkdir(); b=d/'repository.bundle'; run('git','-C',str(repo),'bundle','create',str(b),'refs/heads/local-mirror-source'); h=hashlib.sha256(b.read_bytes()).hexdigest(); (d/'manifest.json').write_text(json.dumps({'schema_version':1,'source_repository':'example/repo','source_branch':'main','source_sha':sha,'transport_sha':'0'*40,'bundle_sha256':h,'bundle_bytes':b.stat().st_size,'bundle_ref':'refs/heads/local-mirror-source'})); (d/'SHA256SUMS.txt').write_text(f'{checksum or h}  repository.bundle\n'); z=root/'a.zip';
    with zipfile.ZipFile(z,'w') as f:
        for p in d.iterdir(): f.write(p,p.name)
    return z,sha
class Tests(unittest.TestCase):
    def test_exact_head(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td); z,sha=artifact(root); out=mod.materialize(z,root/'out',sha,'main','https://github.com/example/repo.git'); self.assertEqual(out['head'],sha); self.assertEqual(out['fsck'],'PASS')
    def test_sha_mismatch_fails(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td); z,_=artifact(root)
            with self.assertRaises(mod.MaterializationError): mod.materialize(z,root/'out','f'*40,'main')
    def test_checksum_mismatch_fails(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td); z,sha=artifact(root,'0'*64)
            with self.assertRaises(mod.MaterializationError): mod.materialize(z,root/'out',sha,'main')
    def test_zip_traversal_fails(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td); z=root/'bad.zip'
            with zipfile.ZipFile(z,'w') as f: f.writestr('../escape','x')
            with self.assertRaises(mod.MaterializationError): mod.materialize(z,root/'out','a'*40,'main')
    def test_preferred_template_is_least_authority(self):
        p=(ROOT/'tools'/'local-git-mirror'/'bootstrap-workflow.yml.template').read_text(); f=(ROOT/'tools'/'local-git-mirror'/'bootstrap-workflow-fallback.yml.template').read_text(); self.assertIn('contents: read',p); self.assertIn('persist-credentials: false',p); self.assertIn('retention-days: 1',p); self.assertIn('actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd',p); self.assertIn('actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',p); self.assertIn('contents: write',f); self.assertNotIn('self-hosted',p)
if __name__=='__main__': unittest.main()
