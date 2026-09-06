fn main() {
    napi_build::setup();
    println!("cargo:rerun-if-changed=ort");
    for name in [
        "CC",
        "CXX",
        "MACOSX_DEPLOYMENT_TARGET",
        "DEVELOPER_DIR",
        "PATH",
    ] {
        println!("cargo:rerun-if-env-changed={name}");
    }
    let target = std::env::var("TARGET").unwrap();
    assert_eq!(
        std::env::var("HOST").unwrap(),
        target,
        "ORT builds require a native host"
    );
    let out = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
    // OUT_DIR is target[/triple]/profile/build/package/out. Reuse across
    // profiles inside this Cargo target directory, under Cargo's build lock.
    let cache = out.ancestors().nth(4).unwrap().join("ort-runtime");
    let output = std::process::Command::new("python3")
        .args(["ort/prepare.py", "--target", &target, "--cache"])
        .arg(cache)
        .stderr(std::process::Stdio::inherit())
        .output()
        .expect("Python 3, CMake, Ninja and the documented C++ compiler are required for ORT");
    assert!(output.status.success(), "pinned ORT source build failed");
    let archive = std::path::PathBuf::from(String::from_utf8(output.stdout).unwrap().trim());
    // Final-link arguments follow Rust dependency archives. A native library on
    // this parent crate's -l list is scanned before ort's unresolved API symbols.
    println!("cargo:rustc-link-arg={}", archive.display());
    if target.ends_with("apple-darwin") {
        println!("cargo:rustc-link-arg=-lc++");
        println!("cargo:rustc-link-arg=-framework");
        println!("cargo:rustc-link-arg=Foundation");
    } else {
        println!("cargo:rustc-link-arg=-lstdc++");
        // GCC's outlined ARM atomics live in libgcc.a, not libgcc_s. They must
        // be resolved after the source-built archive introduces those symbols.
        println!("cargo:rustc-link-arg=-lgcc");
    }
}
