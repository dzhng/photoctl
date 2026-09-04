use std::{env, path::PathBuf};

const MACOS_DEPLOYMENT_TARGET: &str = "11.0";

fn main() {
    let manifest = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("manifest directory"));
    let vendor = manifest.join("vendor");
    let pattern = vendor.join("src/**/*.cpp");
    let mut sources = glob::glob(pattern.to_str().expect("UTF-8 source glob"))
        .expect("valid LibRaw source glob")
        .collect::<Result<Vec<_>, _>>()
        .expect("read vendored LibRaw sources");
    // `_ph` files are alternate no-postprocessing stubs; linking them beside the full sources
    // creates duplicate definitions (and would replace the AHD path if selected alone).
    sources.retain(|source| {
        !source
            .file_name()
            .is_some_and(|name| name.to_string_lossy().ends_with("_ph.cpp"))
    });
    sources.sort();

    let mut build = cc::Build::new();
    build
        .cpp(true)
        .std("c++11")
        .warnings(false)
        .define("NO_JPEG", None)
        .define("NO_LCMS", None)
        .include(&vendor)
        .include(vendor.join("internal"))
        .file(manifest.join("src/photoctl_libraw.cpp"))
        .files(sources);

    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        build.flag("-stdlib=libc++");
        build.flag(&format!("-mmacosx-version-min={MACOS_DEPLOYMENT_TARGET}"));
        println!("cargo:rustc-link-lib=dylib=c++");
        println!("cargo:rustc-link-arg=-mmacosx-version-min={MACOS_DEPLOYMENT_TARGET}");
    } else if env::var("CARGO_CFG_TARGET_ENV").as_deref() != Ok("msvc") {
        println!("cargo:rustc-link-lib=dylib=stdc++");
    }

    build.compile("photoctl_libraw");
    println!("cargo:rerun-if-changed=src/photoctl_libraw.cpp");
    println!("cargo:rerun-if-changed=src/photoctl_libraw.h");
    println!("cargo:rerun-if-changed=vendor/src");
    println!("cargo:rerun-if-changed=vendor/libraw");
}
