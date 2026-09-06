"""Build the pinned CPU runtime. Cargo owns serialization of its target-local cache.

The Docker recipe layer calls this once before Cargo, never concurrently. This
script installs no tools and has no binary-download or upload fallback.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent
TARGETS = {
    "aarch64-unknown-linux-gnu": ("Linux", "aarch64"),
    "x86_64-unknown-linux-gnu": ("Linux", "x86_64"),
    "aarch64-apple-darwin": ("Darwin", "arm64"),
    "x86_64-apple-darwin": ("Darwin", "x86_64"),
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def file_digest(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def run(*args, cwd=None):
    subprocess.run(args, cwd=cwd, check=True, stdout=sys.stderr)


def output(*args, cwd=None):
    return subprocess.check_output(args, cwd=cwd, text=True).strip()


def identity(target):
    if TARGETS.get(target) != (platform.system(), platform.machine()):
        raise ValueError(f"ORT recipe requires a native supported host for {target}")
    apple = target.endswith("apple-darwin")
    cc = os.environ.get("CC", "clang" if apple else "gcc-14")
    cxx = os.environ.get("CXX", "clang++" if apple else "g++-14")
    tools = {tool: output(tool, "--version") for tool in (cc, cxx, "cmake", "ninja")}
    tools["python"] = sys.version
    if not apple:
        tools.update({tool: output(tool, "--version") for tool in ("ar", "ld")})
    flags = [
        "-DCMAKE_BUILD_TYPE=Release",
        "-DCMAKE_CONFIGURATION_TYPES=Release",
        f"-DCMAKE_C_COMPILER={cc}",
        f"-DCMAKE_CXX_COMPILER={cxx}",
        "-Donnxruntime_BUILD_UNIT_TESTS=OFF",
        "-Donnxruntime_CLIENT_PACKAGE_BUILD=ON",
        "-Donnxruntime_USE_KLEIDIAI=" + ("ON" if target.startswith("aarch64") else "OFF"),
        "-DCMAKE_EXE_LINKER_FLAGS=",
        "-DCMAKE_SHARED_LINKER_FLAGS=",
    ]
    arch_flags = "-march=x86-64-v3" if target == "x86_64-unknown-linux-gnu" else ""
    flags += [f"-DCMAKE_C_FLAGS={arch_flags}", f"-DCMAKE_CXX_FLAGS={arch_flags}"]
    if target.startswith("x86_64"):
        flags += ["-Donnxruntime_USE_AVX2=ON"]
    if apple:
        deployment_target = os.environ.get("MACOSX_DEPLOYMENT_TARGET", "").strip()
        if not deployment_target:
            raise ValueError("Apple ORT builds require MACOSX_DEPLOYMENT_TARGET from the workspace Cargo policy")
        sdk = output("xcrun", "--show-sdk-path")
        tools["apple-sdk"] = output("xcrun", "--show-sdk-version")
        flags += [
            f"-DCMAKE_OSX_SYSROOT={sdk}",
            "-DCMAKE_OSX_ARCHITECTURES=" + TARGETS[target][1],
            "-DCMAKE_OSX_DEPLOYMENT_TARGET=" + deployment_target,
        ]
    recipe = json.loads((ROOT / "recipe.json").read_text())
    for name, expected in recipe["patches"].items():
        if file_digest(ROOT / "patches" / name) != expected:
            raise ValueError(f"ORT patch digest mismatch: {name}")
    return {
        "recipe": recipe,
        "target": target,
        "tools": tools,
        "flags": flags,
        "preparer": file_digest(Path(__file__)),
        "cmake": file_digest(ROOT / "CMakeLists.txt"),
    }


def prepare(target, cache):
    facts = identity(target)
    key = digest(json.dumps(facts, sort_keys=True).encode())
    directory = cache.resolve() / key
    directory.mkdir(parents=True, exist_ok=True)
    archive = directory / "build" / "libonnxruntime_static_lib.a"
    record = directory / "provenance.json"
    if record.exists():
        retained = json.loads(record.read_text())
        if retained["identity"] != facts or not archive.is_file() or file_digest(archive) != retained["sha256"]:
            raise ValueError(f"ORT cache integrity failure at {directory}; remove this exact cache entry and rebuild")
        print(archive)
        return
    started = time.monotonic()
    source = directory / "source"
    marker = directory / "source.json"
    recipe = facts["recipe"]
    if not marker.exists():
        # Interrupted acquisition is resumable. Checkout is confined to this
        # newly owned cache repository; never reset a user's source checkout.
        if not source.exists():
            run("git", "init", str(source))
        if (source / ".git" / "HEAD").exists():
            run("git", "-c", "http.lowSpeedLimit=1024", "-c", "http.lowSpeedTime=60",
                "-C", str(source), "fetch", "--depth=1", recipe["source"], recipe["commit"])
        if (source / "VERSION_NUMBER").exists():
            raise ValueError(f"Incomplete ORT patch application at {source}; remove this exact cache entry and retry")
        run("git", "-C", str(source), "checkout", "--detach", "FETCH_HEAD")
        if output("git", "rev-parse", "HEAD", cwd=source) != recipe["commit"]:
            raise ValueError("ORT source commit mismatch")
        for name in recipe["patches"]:
            # The pinned vendor patches require recounting their hunk lengths,
            # exactly as their upstream build recipe does.
            run("git", "apply", "--ignore-whitespace", "--recount", str(ROOT / "patches" / name), cwd=source)
        marker.write_text(json.dumps({"diff": digest(output("git", "diff", "--binary", cwd=source).encode())}))
    if output("git", "rev-parse", "HEAD", cwd=source) != recipe["commit"] or json.loads(marker.read_text())["diff"] != digest(output("git", "diff", "--binary", cwd=source).encode()):
        raise ValueError(f"ORT cached source was modified: {source}")
    build = directory / "build"
    run("cmake", "-S", str(ROOT), "-B", str(build), "-G", "Ninja",
        f"-DONNXRUNTIME_SOURCE_DIR={source}", *facts["flags"], "--compile-no-warning-as-error")
    run("cmake", "--build", str(build), "--target", "bundling_onnxruntime_static_lib", "--parallel", "2")
    provenance = {"identity": facts, "sha256": file_digest(archive), "build_seconds": time.monotonic() - started}
    temporary = directory / "provenance.pending"
    temporary.write_text(json.dumps(provenance, indent=2) + "\n")
    temporary.replace(record)
    print(archive)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", required=True, choices=TARGETS)
    parser.add_argument("--cache", required=True, type=Path)
    args = parser.parse_args()
    try:
        prepare(args.target, args.cache)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f"Pinned ORT build failed: {error}", file=sys.stderr)
        sys.exit(1)
