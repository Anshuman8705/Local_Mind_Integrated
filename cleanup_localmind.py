#!/usr/bin/env python3
"""Reversible, allowlist-only cleanup for the audited LocalMind ZIP.

Python 3.9+; no additional packages. Preview is the default.
Close LocalMind, model downloads, and development servers before --apply.
This does not make an EXE or remove active application data.
"""
from __future__ import annotations

import argparse
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import sys
import uuid

# Exact paths and content hashes from project_archive.zip (15 September 2026).
# Current setup/architecture docs, MIGRATION.md, validation JSON, models,
# credentials, databases, migrations, tests, CI and all other files are retained.
ALLOWLIST = json.loads(r'''[
{"path":".changes/adaptive-01.b64","group":"history","audit_sha256":"015f58e7187df9d016780ec226929d97bda5016d1d8f5b01797d03f23b9b5ec3","lf_sha256":"015f58e7187df9d016780ec226929d97bda5016d1d8f5b01797d03f23b9b5ec3","symbol":""},
{"path":".changes/adaptive-02.b64","group":"history","audit_sha256":"96c233fdc1071c874f2dbc4c9d7624e1a18561ae92918ef264ad5073a1b4d791","lf_sha256":"96c233fdc1071c874f2dbc4c9d7624e1a18561ae92918ef264ad5073a1b4d791","symbol":""},
{"path":".changes/institutional-course-sync.md","group":"history","audit_sha256":"be4e46ff4b4f11468c54c0541d69351aa0b28f8c1fa7b318d2e8d868ab7200f0","lf_sha256":"be4e46ff4b4f11468c54c0541d69351aa0b28f8c1fa7b318d2e8d868ab7200f0","symbol":""},
{"path":".changes/private-study-recovery.md","group":"history","audit_sha256":"f36b7d0af4c07150e68e48680041b31b05e110d9e9e58926b68e5c534956aad5","lf_sha256":"f36b7d0af4c07150e68e48680041b31b05e110d9e9e58926b68e5c534956aad5","symbol":""},
{"path":".localmind-integrated-private-library","group":"history","audit_sha256":"430e79f9758c3b21fb820c06d8f8ec650f015abedce8e8e2b74a01800993b453","lf_sha256":"430e79f9758c3b21fb820c06d8f8ec650f015abedce8e8e2b74a01800993b453","symbol":""},
{"path":".localmind-offline-foundation","group":"history","audit_sha256":"82902b30d9ec6b5e50ecc6056133d5b16aefa7ee178b444c651ed1d383e254e4","lf_sha256":"82902b30d9ec6b5e50ecc6056133d5b16aefa7ee178b444c651ed1d383e254e4","symbol":""},
{"path":"MD_ALIGNMENT_START_HERE.md","group":"history","audit_sha256":"2725db1abbe0d3b220c2fe3af881ed13a1811a1be8ba63ca29ae738e1681b524","lf_sha256":"2725db1abbe0d3b220c2fe3af881ed13a1811a1be8ba63ca29ae738e1681b524","symbol":""},
{"path":"backend/backend-test-log.txt","group":"generated","audit_sha256":"d374a7df767f0a6a4cffa6537c58959dbcd20307bdec7601667dc8df814fdab7","lf_sha256":"d374a7df767f0a6a4cffa6537c58959dbcd20307bdec7601667dc8df814fdab7","symbol":""},
{"path":"backend/models/docling/docling-project--docling-layout-heron-onnx/.cache/huggingface/.gitignore","group":"generated","audit_sha256":"684888c0ebb17f374298b65ee2807526c066094c701bcc7ebbe1c1095f494fc1","lf_sha256":"684888c0ebb17f374298b65ee2807526c066094c701bcc7ebbe1c1095f494fc1","symbol":""},
{"path":"backend/models/docling/docling-project--docling-layout-heron-onnx/.cache/huggingface/CACHEDIR.TAG","group":"generated","audit_sha256":"e8893e2dcb3f4545ef67a0a5b7b769113d38eef1aa61c7c7ba14659b02af955f","lf_sha256":"f6572428f6d5e1575e73a1502895a8731f10757dfbb634909c6e154b849af91d","symbol":""},
{"path":"backend/models/docling/docling-project--docling-layout-heron-onnx/.cache/huggingface/download/.gitattributes.metadata","group":"generated","audit_sha256":"954f67c5b59629aa4721ff80d5054ed8c0a83162f9acb64232b9004eeb6ca43d","lf_sha256":"f57959344d65904d3d23ed4a53f368e12afeffd864898c4e8b7e289e8e48e5ac","symbol":""},
{"path":"backend/models/docling/docling-project--docling-layout-heron-onnx/.cache/huggingface/download/README.md.metadata","group":"generated","audit_sha256":"3bb57a8d2bdee792d13a72439c7d3c644c6dd43a8a7c829228f1d75baad3950f","lf_sha256":"92155eca5213a6d59ab0ba59434372a5dc2ebdacdea9c36e30bfad9ca361d1df","symbol":""},
{"path":"backend/models/docling/docling-project--docling-layout-heron-onnx/.cache/huggingface/download/config.json.metadata","group":"generated","audit_sha256":"efc1dde584ff5ca8c704c78afbe79e8424dc9698e1fcf7864ae984da760a0dfe","lf_sha256":"35c9ac012da791e8843d2bb465d5e3f26309da91bbf034f1ec4827913f81ec5e","symbol":""},
{"path":"backend/models/docling/docling-project--docling-layout-heron-onnx/.cache/huggingface/download/model.onnx.metadata","group":"generated","audit_sha256":"86cdd67eee5a9b77b4b5a030e20872784a37bfbe0028c18e7503b687f23f6ed4","lf_sha256":"9cbaeefac116b37c4f47d60dbd63746f2d2a7e9b58f4c88b1cee7ba21e31eb9b","symbol":""},
{"path":"backend/models/docling/docling-project--docling-layout-heron-onnx/.cache/huggingface/download/preprocessor_config.json.metadata","group":"generated","audit_sha256":"341046c9a8a4b5923cb5899da200eaf1f7f1ec5492a733689c10b7b1101aa62e","lf_sha256":"e44f6acc163a38a668ba3711c3da9e59e3fda4dfb1c6485fe060ce04cbdad171","symbol":""},
{"path":"backend/models/docling/docling-project--docling-layout-heron-onnx/.cache/huggingface/trees/40bde044036bb181c130ddf6c51792187268748f.json","group":"generated","audit_sha256":"f0d35adef2fb9c95b27b96dd51bb5d801593a241f4ae7014020d82e85e295bd2","lf_sha256":"bf77257f92da661c7a941042e96de82d5717230f3b986340116da5137820cd9e","symbol":""},
{"path":"backend/models/docling/docling-project--docling-layout-heron/.cache/huggingface/.gitignore","group":"generated","audit_sha256":"684888c0ebb17f374298b65ee2807526c066094c701bcc7ebbe1c1095f494fc1","lf_sha256":"684888c0ebb17f374298b65ee2807526c066094c701bcc7ebbe1c1095f494fc1","symbol":""},
{"path":"backend/models/docling/docling-project--docling-layout-heron/.cache/huggingface/CACHEDIR.TAG","group":"generated","audit_sha256":"e8893e2dcb3f4545ef67a0a5b7b769113d38eef1aa61c7c7ba14659b02af955f","lf_sha256":"f6572428f6d5e1575e73a1502895a8731f10757dfbb634909c6e154b849af91d","symbol":""},
{"path":"backend/models/docling/docling-project--docling-layout-heron/.cache/huggingface/download/.gitattributes.metadata","group":"generated","audit_sha256":"1a74b6a0220578a2b4af9028f866f5b556b0c9963ae313f380d9fcd39b90bcc1","lf_sha256":"2f32beac2f266dac06a172d03e7bd8bf9d9a5c15f3332167115d13081a10f4ed","symbol":""},
{"path":"backend/models/docling/docling-project--docling-layout-heron/.cache/huggingface/download/README.md.metadata","group":"generated","audit_sha256":"7abd7d0e3976f21f0f3768591673379210e182d088eda7a27ffb0050d86f699a","lf_sha256":"5627ce934d990431306740bd1c46a0b4e4131a6f92259d5e42559938a4b6712d","symbol":""},
{"path":"backend/models/docling/docling-project--docling-layout-heron/.cache/huggingface/download/config.json.metadata","group":"generated","audit_sha256":"cfb2d9dc46fceadfca47cd756b2cbb207519994566187e0c617523b53f8e9a11","lf_sha256":"8f4c4bcb3d5b1f185bf322635b80732261ca89dd0bba49b3d71441ebc882bf5b","symbol":""},
{"path":"backend/models/docling/docling-project--docling-layout-heron/.cache/huggingface/download/docling_heron_400.png.metadata","group":"generated","audit_sha256":"eba90f5b3b7f8d6ebe46b5133b95d123e42547f6b3589a2c26887fbd5a1c71c4","lf_sha256":"614bbd4517acea1b81d42dd97fa9a4e955a3ad1946104d3389d55af0e3684a8b","symbol":""},
{"path":"backend/models/docling/docling-project--docling-layout-heron/.cache/huggingface/download/model.safetensors.metadata","group":"generated","audit_sha256":"2f9a13962ccc2584552f681d1018833e940f47a1fd75b1d849561f5ff29c2327","lf_sha256":"7f155c5009855d9279b848f6c15aa63108660e176741c81af57b983ea929f9eb","symbol":""},
{"path":"backend/models/docling/docling-project--docling-layout-heron/.cache/huggingface/download/preprocessor_config.json.metadata","group":"generated","audit_sha256":"0827373c42d9c896a328de58d467ddf0cbf26772d1b2b56e4514116b2152540b","lf_sha256":"4760cd95860e80e7f2ce0664e0a8297c1c7bee34f5775202d1bfc28584145ab7","symbol":""},
{"path":"backend/models/docling/docling-project--docling-layout-heron/.cache/huggingface/trees/8f39ad3c0b4c58e9c2d2c84a38465abf757272d8.json","group":"generated","audit_sha256":"4432c535d8998a7af9a7c09dc926791fc507d46d811229205186d9b060615dde","lf_sha256":"bc7fa4e3aab7315b44d7897eca8056d69388ccb80d33db5f9ba7d6fa2a8fe9f2","symbol":""},
{"path":"backend/models/docling/docling-project--docling-models/.cache/huggingface/.gitignore","group":"generated","audit_sha256":"684888c0ebb17f374298b65ee2807526c066094c701bcc7ebbe1c1095f494fc1","lf_sha256":"684888c0ebb17f374298b65ee2807526c066094c701bcc7ebbe1c1095f494fc1","symbol":""},
{"path":"backend/models/docling/docling-project--docling-models/.cache/huggingface/CACHEDIR.TAG","group":"generated","audit_sha256":"e8893e2dcb3f4545ef67a0a5b7b769113d38eef1aa61c7c7ba14659b02af955f","lf_sha256":"f6572428f6d5e1575e73a1502895a8731f10757dfbb634909c6e154b849af91d","symbol":""},
{"path":"backend/models/docling/docling-project--docling-models/.cache/huggingface/download/.gitattributes.metadata","group":"generated","audit_sha256":"94d05a1dccc103c427f6240896a8302344e3f38aaab05156077595068658064c","lf_sha256":"4db1659a3651c2b836eefbb0aa74272208b30661cce4222ae1570e18a822cf10","symbol":""},
{"path":"backend/models/docling/docling-project--docling-models/.cache/huggingface/download/.gitignore.metadata","group":"generated","audit_sha256":"2a55e585b80faadd742fb04b949e5409902ada30f7544c6aa992b2bfd38c0d69","lf_sha256":"319d53aeda1d349731b555a41383e14f4b691babee95de34883d5a4089b35760","symbol":""},
{"path":"backend/models/docling/docling-project--docling-models/.cache/huggingface/download/README.md.metadata","group":"generated","audit_sha256":"8aca8d4fd67acdaf74efbf8862caecc0fb77d80cec63396889f4022a9fd3cfa8","lf_sha256":"9d84798226fe1384a7501f18cbd52ce4e4b6e912f636d10ad11575219e52ad9f","symbol":""},
{"path":"backend/models/docling/docling-project--docling-models/.cache/huggingface/download/config.json.metadata","group":"generated","audit_sha256":"45343223f0f946b16fbefe44bec38aaebfba2fd41566117dd2054338b042c4a9","lf_sha256":"8b5d54dcce32777f21713a76991c3e8eb206830fc31b1f84b7bb5e2bd936bb8a","symbol":""},
{"path":"backend/models/docling/docling-project--docling-models/.cache/huggingface/download/model_artifacts/tableformer/accurate/tableformer_accurate.safetensors.metadata","group":"generated","audit_sha256":"ddb08c006884a934ecb87f2989aa0b52e73a7c10f005a586d27e9e9e84b78bef","lf_sha256":"d63fb8f2bc48d2c570c777add2355155173607498dd90204d0eafeb0ccc81d68","symbol":""},
{"path":"backend/models/docling/docling-project--docling-models/.cache/huggingface/download/model_artifacts/tableformer/accurate/tm_config.json.metadata","group":"generated","audit_sha256":"bdbeb096189b30707578f1c8693793886fb4bdf0215840e529e67239b336add0","lf_sha256":"bc3594e9543c7bc46bc58c651d00be9ae7e42d582224e2108639c5376d8c83e7","symbol":""},
{"path":"backend/models/docling/docling-project--docling-models/.cache/huggingface/download/model_artifacts/tableformer/fast/tableformer_fast.safetensors.metadata","group":"generated","audit_sha256":"0ae038af657b9d7fd5b611e1678e262670c98d1738f6f0b76d4727c7d7e21c2a","lf_sha256":"cf619df559f91d90234fcded2ca241620dcec26c21df478a10bb547fdfee6416","symbol":""},
{"path":"backend/models/docling/docling-project--docling-models/.cache/huggingface/download/model_artifacts/tableformer/fast/tm_config.json.metadata","group":"generated","audit_sha256":"687503de4dbcd0e718ce296139e10db43a0433d48df78d0fb6a5b2335cfd5c82","lf_sha256":"84de2704cba1dd6675193215d9f8dcb8d2e48c72a6ee4f579759f6f3e7b1d211","symbol":""},
{"path":"backend/models/docling/docling-project--docling-models/.cache/huggingface/trees/fc0f2d45e2218ea24bce5045f58a389aed16dc23.json","group":"generated","audit_sha256":"32e1c3c0c6a2c41b0ac1b380398f389715555fce0f245453756480046750a078","lf_sha256":"8f74cb05610126508c4afcae60003fb238e7845e53655de6f3140c979e826df0","symbol":""},
{"path":"docs/CHANGES-2026-09-10-ask-a-doubt.md","group":"history","audit_sha256":"f5327c58b3fa39e6c27c5b4d4dbcb0a8fd18834159d0f08a96896ce0375f2671","lf_sha256":"f5327c58b3fa39e6c27c5b4d4dbcb0a8fd18834159d0f08a96896ce0375f2671","symbol":""},
{"path":"docs/CHANGES-2026-09-10-auto-quiz-review.md","group":"history","audit_sha256":"49b9dd3e825bc977938ca073bd3513b779b2c6fdadc10bfab1eae7e41bb41a64","lf_sha256":"49b9dd3e825bc977938ca073bd3513b779b2c6fdadc10bfab1eae7e41bb41a64","symbol":""},
{"path":"docs/CHANGES-2026-09-10-auto-quizzes-and-offline.md","group":"history","audit_sha256":"b2f542ef9a9e04e9d41a23d268bf58c9cd493cd4fa95dcf4bb12faecc09a55c6","lf_sha256":"b2f542ef9a9e04e9d41a23d268bf58c9cd493cd4fa95dcf4bb12faecc09a55c6","symbol":""},
{"path":"docs/CHANGES-2026-09-10-background-lessons.md","group":"history","audit_sha256":"0d17f69f6911d7b9a222ecbb868519736d61d56f4d384378f1c37ec212015003","lf_sha256":"0d17f69f6911d7b9a222ecbb868519736d61d56f4d384378f1c37ec212015003","symbol":""},
{"path":"docs/CHANGES-2026-09-10-quiz-generation.md","group":"history","audit_sha256":"e902544843a50c4f09c4ecdad198144816b6f9e121a3be4816a2c5f6e235e0ba","lf_sha256":"e902544843a50c4f09c4ecdad198144816b6f9e121a3be4816a2c5f6e235e0ba","symbol":""},
{"path":"docs/CHANGES-2026-09-10-security-and-results.md","group":"history","audit_sha256":"57f025a69dc6e69315f72061a9f0a405c1c528ce1274f1d23d9ad6183cd9acb4","lf_sha256":"57f025a69dc6e69315f72061a9f0a405c1c528ce1274f1d23d9ad6183cd9acb4","symbol":""},
{"path":"docs/CHANGES-2026-09-10-tidy-outlines.md","group":"history","audit_sha256":"40775f330f6c86e1b755c17b242747cf372fb209bfb032a19d368c1609ae765a","lf_sha256":"40775f330f6c86e1b755c17b242747cf372fb209bfb032a19d368c1609ae765a","symbol":""},
{"path":"docs/CHANGES-2026-09-11-admin-reload.md","group":"history","audit_sha256":"2b900ec32f4ee7e8a4c66fc8619e85289d3537f6e9f6193498d7a20aa5d21172","lf_sha256":"2b900ec32f4ee7e8a4c66fc8619e85289d3537f6e9f6193498d7a20aa5d21172","symbol":""},
{"path":"docs/CHANGES-2026-09-11-audit-fixes.md","group":"history","audit_sha256":"0f498b79856a81f45712c6eaf3c2d9ad7a7fcac3dfd18300acd1252939b749fc","lf_sha256":"0f498b79856a81f45712c6eaf3c2d9ad7a7fcac3dfd18300acd1252939b749fc","symbol":""},
{"path":"docs/CHANGES-2026-09-11-cleanup-release.md","group":"history","audit_sha256":"e68ee8e3af8969e1a50e8ac2b25b114b3227ba66b620141058559b06cf60c986","lf_sha256":"e68ee8e3af8969e1a50e8ac2b25b114b3227ba66b620141058559b06cf60c986","symbol":""},
{"path":"docs/CHANGES-2026-09-11-new-ui.md","group":"history","audit_sha256":"d7952724b9a0910578fd3799b4bb3ea385954fe87e92c7fec3fee9569328cc12","lf_sha256":"d7952724b9a0910578fd3799b4bb3ea385954fe87e92c7fec3fee9569328cc12","symbol":""},
{"path":"docs/CHANGES-2026-09-11-outline-guard.md","group":"history","audit_sha256":"4f5ba80552d3cc35be2ed7be688680ea50d2773a13a296c45a70ed49ecf97e94","lf_sha256":"4f5ba80552d3cc35be2ed7be688680ea50d2773a13a296c45a70ed49ecf97e94","symbol":""},
{"path":"docs/CHANGES-2026-09-11-short-table-names.md","group":"history","audit_sha256":"1b28ae4b44da57d214ab08fa0c4b629edf1f4c9b6c98c07063d61d009cfd9d18","lf_sha256":"1b28ae4b44da57d214ab08fa0c4b629edf1f4c9b6c98c07063d61d009cfd9d18","symbol":""},
{"path":"docs/history/AI_RUNTIME_FIXES.md","group":"history","audit_sha256":"24faa27fa5e3290680256146d9048aa8a52302c49e6f3953cdc261300929e384","lf_sha256":"24faa27fa5e3290680256146d9048aa8a52302c49e6f3953cdc261300929e384","symbol":""},
{"path":"docs/history/CHANGES-2026-09-03-performance-v5.md","group":"history","audit_sha256":"1e584b23a7f379871497ab60e4170754bdeded58aff01f92780ee430cb8f845e","lf_sha256":"1e584b23a7f379871497ab60e4170754bdeded58aff01f92780ee430cb8f845e","symbol":""},
{"path":"docs/history/CHANGES-2026-09-03-performance.md","group":"history","audit_sha256":"fc6b4070f6419753c0bd3dcad6663d57169605fe459f06e848e59110816c1969","lf_sha256":"fc6b4070f6419753c0bd3dcad6663d57169605fe459f06e848e59110816c1969","symbol":""},
{"path":"docs/history/CHANGES-2026-09-03.md","group":"history","audit_sha256":"c4a0ee7fcff2b981e6542457966a19a706248c198faa93a744966da0685ca46a","lf_sha256":"c4a0ee7fcff2b981e6542457966a19a706248c198faa93a744966da0685ca46a","symbol":""},
{"path":"docs/history/CHANGES-outline-workspace.md","group":"history","audit_sha256":"a9129e8910407df6bea4be7cc825ce71cdcfc7bfb6923d1b51b065370c67799d","lf_sha256":"a9129e8910407df6bea4be7cc825ce71cdcfc7bfb6923d1b51b065370c67799d","symbol":""},
{"path":"docs/history/CHANGES-quiz-assignment-workspace.md","group":"history","audit_sha256":"89120aedeea21cb30ff4ad0912a785a23f106c73bb55071a7382d5faba96ebc8","lf_sha256":"89120aedeea21cb30ff4ad0912a785a23f106c73bb55071a7382d5faba96ebc8","symbol":""},
{"path":"docs/history/PRODUCTION_READINESS.md","group":"history","audit_sha256":"7a31ca342876fe0616c8625607eeb4a30b9ff390a231be1633f337773e6dc49b","lf_sha256":"7a31ca342876fe0616c8625607eeb4a30b9ff390a231be1633f337773e6dc49b","symbol":""},
{"path":"frontend/src/ui/ModulePicker.tsx","group":"unused-ui","audit_sha256":"69cb3cb305d7e7e16440b55aa6d8b49c6e66825dc43fd7ebe491024f25ec8740","lf_sha256":"69cb3cb305d7e7e16440b55aa6d8b49c6e66825dc43fd7ebe491024f25ec8740","symbol":"ModulePicker"},
{"path":"frontend/src/ui/SelectField.tsx","group":"unused-ui","audit_sha256":"56cb4a54cb750809a4bbabc0fc690f1a5e053a1284e8d94a4c524ecd8c1f877f","lf_sha256":"56cb4a54cb750809a4bbabc0fc690f1a5e053a1284e8d94a4c524ecd8c1f877f","symbol":"SelectField"},
{"path":"frontend/src/ui/TargetPicker.tsx","group":"unused-ui","audit_sha256":"53f4dff818701b1843d90c9cea8fe476a80e23c708246cc04bafcba2b22fd447","lf_sha256":"53f4dff818701b1843d90c9cea8fe476a80e23c708246cc04bafcba2b22fd447","symbol":"TargetPicker"},
{"path":"scripts/apply_private_integration.py","group":"history","audit_sha256":"3af5e92788cdab9bf3bd8e9524650cfddd137f5538197f1ae45eff5a023a60d5","lf_sha256":"3af5e92788cdab9bf3bd8e9524650cfddd137f5538197f1ae45eff5a023a60d5","symbol":""},
{"path":"validation/md-alignment-tests.log","group":"generated","audit_sha256":"2ede60e9d943c3641d27d11291ef3460dbee2ab7955fff999d7c363da6b14b45","lf_sha256":"2ede60e9d943c3641d27d11291ef3460dbee2ab7955fff999d7c363da6b14b45","symbol":""}
]''')
ALLOWED = {entry["path"]: entry for entry in ALLOWLIST}
PRUNE_ROOTS = (
    ".changes",
    "backend/models/docling/docling-project--docling-layout-heron/.cache",
    "backend/models/docling/docling-project--docling-layout-heron-onnx/.cache",
    "backend/models/docling/docling-project--docling-models/.cache",
)
SOURCE_EXTENSIONS = {
    ".py", ".pyi", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
    ".json", ".yml", ".yaml", ".html", ".vue", ".svelte", ".toml",
    ".cfg", ".ini", ".ps1", ".bat", ".cmd", ".sh", ".spec",
}
SKIP_DIRECTORY_NAMES = {
    ".git", ".venv", "venv", "node_modules", "__pycache__", ".expo",
    "dist", "build", ".next", ".cache", ".pytest_cache", ".mypy_cache",
    ".ruff_cache", ".test-build", "test-results", "playwright-report",
}
SKIP_RELATIVE_DIRS = {
    "backend/models", "backend/staticfiles", "backend/media",
    "backend/private-books", "frontend/public/private-assets",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def reject_links(path: Path) -> None:
    """Reject symlinks and Windows junctions, including parent directories."""
    for current in (path, *path.parents):
        try:
            info = current.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(info.st_mode) or (
            getattr(info, "st_file_attributes", 0)
            & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
        ):
            raise RuntimeError(f"Refusing a symlink/junction path: {current}")


def absolute_directory(raw: str) -> Path:
    path = Path(os.path.abspath(os.path.expanduser(raw)))
    reject_links(path)
    if not path.is_dir():
        raise ValueError(f"Directory does not exist: {path}")
    return path


def project_root(raw: str) -> Path:
    root = absolute_directory(raw)
    if root.parent == root:
        raise ValueError("The project root cannot be a drive/filesystem root.")
    for rel in ("backend/manage.py", "backend/config/settings.py", "frontend/package.json"):
        marker = root.joinpath(*PurePosixPath(rel).parts)
        reject_links(marker)
        if not marker.is_file():
            raise ValueError(f"Not the LocalMind project root; missing: {rel}")
    return root


def target(root: Path, relative: str) -> Path:
    # Never accept arbitrary paths from a backup manifest.
    if relative not in ALLOWED:
        raise ValueError(f"Path is not on the audited allowlist: {relative}")
    rel = PurePosixPath(relative)
    if rel.is_absolute() or ".." in rel.parts or "\\" in relative:
        raise ValueError(f"Unsafe relative path: {relative}")
    result = root.joinpath(*rel.parts)
    reject_links(result)
    return result


def write_manifest(backup: Path, manifest: dict) -> None:
    temp = backup / "manifest.json.tmp"
    temp.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    os.replace(temp, backup / "manifest.json")


def copy_verified(source: Path, destination: Path, expected_hash: str) -> None:
    """Create a new copy only; never overwrite an existing destination."""
    reject_links(source)
    reject_links(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    created = False
    try:
        with source.open("rb") as incoming:
            with destination.open("xb") as outgoing:
                created = True
                shutil.copyfileobj(incoming, outgoing, length=1024 * 1024)
                outgoing.flush()
                os.fsync(outgoing.fileno())
        if sha256(destination) != expected_hash:
            raise RuntimeError(f"Copy verification failed: {destination}")
        shutil.copystat(source, destination, follow_symlinks=False)
    except Exception:
        if created and destination.exists():
            try:
                destination.unlink()
            except OSError:
                pass
        raise


def source_references(root: Path, symbols: set[str]) -> dict[str, list[str]]:
    """Conservative text-reference check, not a full dependency graph."""
    found = {symbol: [] for symbol in symbols}
    this_script = Path(__file__).absolute()
    own_files = {f"frontend/src/ui/{symbol}.tsx": symbol for symbol in symbols}

    def walk_error(error: OSError) -> None:
        raise error

    for folder, directories, files in os.walk(root, topdown=True, followlinks=False, onerror=walk_error):
        base = Path(folder)
        kept = []
        for name in directories:
            path = base / name
            rel = path.relative_to(root).as_posix()
            if name in SKIP_DIRECTORY_NAMES or rel in SKIP_RELATIVE_DIRS:
                continue
            reject_links(path)
            kept.append(name)
        directories[:] = kept
        for name in files:
            path = base / name
            if path == this_script or path.suffix.lower() not in SOURCE_EXTENSIONS:
                continue
            reject_links(path)
            if not path.is_file():
                raise RuntimeError(f"Non-regular source path: {path}")
            if path.stat().st_size > 20 * 1024 * 1024:
                raise RuntimeError(f"Source file is too large to verify safely: {path}")
            # Latin-1 fallback lets ASCII symbol names be checked in older text encodings.
            raw = path.read_bytes()
            try:
                text = raw.decode("utf-8-sig")
            except UnicodeDecodeError:
                text = raw.decode("latin-1")
            rel = path.relative_to(root).as_posix()
            for symbol in symbols:
                if own_files.get(rel) == symbol:
                    continue
                if symbol in text and len(found[symbol]) < 10:
                    found[symbol].append(rel)
    return found


def prune_empty_audited_directories(root: Path, removed: list[str]) -> None:
    directories: set[Path] = set()
    for relative in removed:
        for boundary in PRUNE_ROOTS:
            if not relative.startswith(boundary + "/"):
                continue
            stop = root.joinpath(*PurePosixPath(boundary).parts)
            current = root.joinpath(*PurePosixPath(relative).parts).parent
            while current == stop or stop in current.parents:
                directories.add(current)
                if current == stop:
                    break
                current = current.parent
    for directory in sorted(directories, key=lambda item: len(item.parts), reverse=True):
        reject_links(directory)
        if directory.is_dir():
            try:
                directory.rmdir()  # Empty only. No recursive directory removal.
            except OSError:
                pass


def clean(args: argparse.Namespace) -> int:
    root = project_root(args.root or ".")
    groups = {"generated"}
    if args.archive_history:
        groups.add("history")
    if args.remove_unused_ui:
        groups.add("unused-ui")
    candidates = [row for row in ALLOWLIST if row["group"] in groups]
    references = {}
    reference_error = None
    if args.remove_unused_ui:
        try:
            references = source_references(root, {row["symbol"] for row in candidates if row["symbol"]})
        except (OSError, ValueError, RuntimeError) as exc:
            reference_error = str(exc)
            print(f"WARNING: UI reference check incomplete; keeping all UI candidates. {exc}")
    selected = []
    absent = 0
    skipped = []
    for row in candidates:
        source = target(root, row["path"])
        if not source.exists():
            absent += 1
            continue
        if not source.is_file() or not stat.S_ISREG(source.stat().st_mode):
            raise RuntimeError(f"Expected a regular file: {source}")
        current_hash = sha256(source)
        if row["group"] != "generated" and current_hash != row["audit_sha256"]:
            # A Windows Git checkout may change LF to CRLF. Accept that change only.
            normalized = hashlib.sha256(source.read_bytes().replace(b"\r\n", b"\n")).hexdigest()
            if normalized != row["lf_sha256"]:
                skipped.append((row["path"], "content differs from the audited ZIP"))
                continue
        if row["group"] == "unused-ui":
            hits = references.get(row["symbol"], [])
            if reference_error or hits:
                reason = "reference scan incomplete" if reference_error else "referenced by " + ", ".join(hits)
                skipped.append((row["path"], reason))
                continue
        selected.append({"path": row["path"], "group": row["group"],
                         "sha256": current_hash, "size_bytes": source.stat().st_size})
    print(f"\nProject: {root}")
    print("Mode: " + ("BACK UP, VERIFY, THEN REMOVE" if args.apply else "PREVIEW ONLY -- no project changes"))
    for row in selected:
        print(f"  {row['group']:10} {row['path']}")
    for path, reason in skipped:
        print(f"  KEEP       {path}: {reason}")
    total = sum(row["size_bytes"] for row in selected)
    print(f"\nSelected: {len(selected)} files ({total / 1024:.1f} KiB). Missing/already cleaned: {absent}. Kept for review: {len(skipped)}.")
    if not args.apply or not selected:
        if selected:
            print("Add --apply to make the displayed changes. History and UI removal each require their explicit flag.")
        return 0
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = root.parent / f"{root.name}-cleanup-backup-{stamp}-{uuid.uuid4().hex[:8]}"
    reject_links(backup)
    backup.mkdir(exist_ok=False)
    manifest = {"schema_version": 1, "project_root": str(root),
                "created_at": datetime.now().astimezone().isoformat(),
                "backup_complete": False, "cleanup_complete": False,
                "entries": selected}
    write_manifest(backup, manifest)
    print(f"\nBackup: {backup}", flush=True)
    print("Copying and verifying every selected file before deleting any source file...", flush=True)
    for row in selected:
        source = target(root, row["path"])
        copy_verified(source, target(backup / "files", row["path"]), row["sha256"])
    manifest["backup_complete"] = True
    write_manifest(backup, manifest)
    # Confirm the working files did not change while the backup was being created.
    for row in selected:
        if sha256(target(root, row["path"])) != row["sha256"]:
            raise RuntimeError("A selected file changed during backup. Nothing has been removed. Close editors/downloads and retry.")
    removed = []
    for row in selected:
        source = target(root, row["path"])
        if sha256(source) != row["sha256"]:
            raise RuntimeError(f"File changed during cleanup: {source}. Cleanup stopped; the complete backup is available.")
        source.unlink()
        removed.append(row["path"])
    prune_empty_audited_directories(root, removed)
    manifest["cleanup_complete"] = True
    write_manifest(backup, manifest)
    print(f"Removed {len(removed)} files from the project. The verified backup contains all of them.")
    print("Keep the backup until application and build checks pass.")
    print("Restore preview command:")
    print(f'  python "{Path(__file__).absolute()}" --restore "{backup}"')
    return 0


def restore(args: argparse.Namespace) -> int:
    backup = absolute_directory(args.restore)
    manifest_path = backup / "manifest.json"
    reject_links(manifest_path)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schema_version") != 1 or manifest.get("backup_complete") is not True:
        raise ValueError("This is not a completed, supported cleanup backup. Do not run restore against it.")
    root = project_root(args.root or manifest["project_root"])
    entries = manifest["entries"]
    if not isinstance(entries, list) or len({row["path"] for row in entries}) != len(entries):
        raise ValueError("Invalid or duplicate manifest entries.")
    needed = []
    identical = 0
    # Verify all backup files and all conflicts before copying anything.
    for row in entries:
        source = target(backup / "files", row["path"])
        destination = target(root, row["path"])
        if not source.is_file() or sha256(source) != row["sha256"]:
            raise RuntimeError(f"Backup content is missing or has changed: {row['path']}")
        if destination.exists():
            if destination.is_file() and sha256(destination) == row["sha256"]:
                identical += 1
                continue
            raise RuntimeError(f"Restore would overwrite a changed/new file: {destination}. No restore copies made; reconcile it manually.")
        needed.append(row)
    print(f"Restore target: {root}")
    print("Mode: " + ("RESTORE" if args.apply else "PREVIEW ONLY"))
    for row in needed:
        print(f"  RESTORE {row['path']}")
    print(f"To restore: {len(needed)}. Already present and identical: {identical}.")
    if not args.apply:
        print("Add --apply to restore. The backup will be kept.")
        return 0
    for row in needed:
        copy_verified(target(backup / "files", row["path"]), target(root, row["path"]), row["sha256"])
    print(f"Restored {len(needed)} files. The backup was retained.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--root", help="Project folder containing backend and frontend (default: current directory).")
    parser.add_argument("--apply", action="store_true", help="Make changes; without this flag only show a preview.")
    parser.add_argument("--archive-history", action="store_true", help="Also archive the 28 audited historical files, including 23 Markdown files.")
    parser.add_argument("--remove-unused-ui", action="store_true", help="Also remove the 3 UI candidates if unchanged and no explicit source references are found; run tests afterwards.")
    parser.add_argument("--restore", metavar="BACKUP_FOLDER", help="Restore files from a cleanup backup, without overwriting newer files.")
    args = parser.parse_args()
    if args.restore and (args.archive_history or args.remove_unused_ui):
        parser.error("--restore cannot be combined with the cleanup selection flags.")
    try:
        return restore(args) if args.restore else clean(args)
    except (OSError, ValueError, KeyError, TypeError, RuntimeError) as exc:
        print(f"\nSTOPPED: {exc}", file=sys.stderr)
        print("Do not delete any reported backup folder. Review the error before retrying.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
