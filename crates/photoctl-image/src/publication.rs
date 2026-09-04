use std::{ffi::CString, io, path::Path};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AtomicRenameOutcome {
    Installed,
    Exists,
    Unsupported,
}

pub fn atomic_rename_no_replace(
    source: &Path,
    destination: &Path,
) -> io::Result<AtomicRenameOutcome> {
    let source = path_to_c_string(source)?;
    let destination = path_to_c_string(destination)?;
    let result = platform_rename_no_replace(&source, &destination);
    if result == 0 {
        return Ok(AtomicRenameOutcome::Installed);
    }
    let error = io::Error::last_os_error();
    match error.raw_os_error() {
        Some(libc::EEXIST) => Ok(AtomicRenameOutcome::Exists),
        Some(code) if is_unsupported(code) => Ok(AtomicRenameOutcome::Unsupported),
        _ => Err(error),
    }
}

#[cfg(unix)]
fn path_to_c_string(path: &Path) -> io::Result<CString> {
    use std::os::unix::ffi::OsStrExt;

    CString::new(path.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "path contains a null byte"))
}

#[cfg(target_os = "macos")]
fn platform_rename_no_replace(source: &CString, destination: &CString) -> libc::c_int {
    const RENAME_EXCL: libc::c_uint = 0x0000_0004;
    unsafe extern "C" {
        fn renamex_np(
            from: *const libc::c_char,
            to: *const libc::c_char,
            flags: libc::c_uint,
        ) -> libc::c_int;
    }
    // SAFETY: both pointers are valid, null-terminated path strings for the duration of the call.
    unsafe { renamex_np(source.as_ptr(), destination.as_ptr(), RENAME_EXCL) }
}

#[cfg(target_os = "linux")]
fn platform_rename_no_replace(source: &CString, destination: &CString) -> libc::c_int {
    // SAFETY: the syscall receives valid, null-terminated path strings and does not retain them.
    unsafe {
        libc::syscall(
            libc::SYS_renameat2,
            libc::AT_FDCWD,
            source.as_ptr(),
            libc::AT_FDCWD,
            destination.as_ptr(),
            libc::RENAME_NOREPLACE,
        ) as libc::c_int
    }
}

fn is_unsupported(code: libc::c_int) -> bool {
    matches!(code, libc::ENOSYS | libc::EINVAL | libc::ENOTSUP)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, time::SystemTime};

    fn test_directory(name: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("clock follows Unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "photoctl-atomic-publish-{name}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir(&path).expect("create test directory");
        path
    }

    #[test]
    fn installs_a_sibling_file_without_replacement() {
        let directory = test_directory("success");
        let source = directory.join("output.tmp");
        let destination = directory.join("output.tif");
        fs::write(&source, b"complete bytes").expect("write source");

        assert_eq!(
            atomic_rename_no_replace(&source, &destination).expect("atomic install"),
            AtomicRenameOutcome::Installed
        );
        assert_eq!(
            fs::read(&destination).expect("read destination"),
            b"complete bytes"
        );
        assert!(!source.exists());
        fs::remove_dir_all(directory).expect("remove test directory");
    }

    #[test]
    fn preserves_an_existing_destination_and_source() {
        let directory = test_directory("exists");
        let source = directory.join("output.tmp");
        let destination = directory.join("output.tif");
        fs::write(&source, b"new bytes").expect("write source");
        fs::write(&destination, b"original bytes").expect("write destination");

        assert_eq!(
            atomic_rename_no_replace(&source, &destination).expect("atomic refusal"),
            AtomicRenameOutcome::Exists
        );
        assert_eq!(
            fs::read(&destination).expect("read destination"),
            b"original bytes"
        );
        assert_eq!(fs::read(&source).expect("read source"), b"new bytes");
        fs::remove_dir_all(directory).expect("remove test directory");
    }
}
