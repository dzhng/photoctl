use std::thread::ThreadId;

use napi::{Env, Error, Status};

/// Reports a task's Rust allocation until it is freed or handed to Node's backing store.
/// Keep this on the task, not on the Vec that `compute` moves through worker code.
pub(crate) struct TaskMemory {
    env: Env,
    owner: ThreadId,
    bytes: i64,
}

// SAFETY: napi-rs AsyncTask only borrows the task during worker execution. Task
// construction, resolve/reject and task destruction run on the originating Node
// thread. No method accessing Env is called by compute. release also checks this
// affinity before invoking Node-API. This is not a generally Send Env wrapper.
unsafe impl Send for TaskMemory {}

impl TaskMemory {
    pub(crate) fn for_vec<T>(env: Env, data: &Vec<T>) -> napi::Result<Self> {
        let bytes = data
            .capacity()
            .checked_mul(std::mem::size_of::<T>())
            .and_then(|bytes| i64::try_from(bytes).ok())
            .ok_or_else(|| Error::new(Status::InvalidArg, "Task allocation is too large"))?;
        env.adjust_external_memory(bytes)?;
        Ok(Self {
            env,
            owner: std::thread::current().id(),
            bytes,
        })
    }

    pub(crate) fn release(&mut self) -> napi::Result<()> {
        if self.bytes == 0 {
            return Ok(());
        }
        if self.owner != std::thread::current().id() {
            return Err(Error::new(
                Status::GenericFailure,
                "Task memory must be released on its originating Node thread",
            ));
        }
        self.env.adjust_external_memory(-self.bytes)?;
        self.bytes = 0;
        Ok(())
    }
}

impl Drop for TaskMemory {
    fn drop(&mut self) {
        // Unlike Task::finally, Drop also runs on completion's early error exits
        // and failures before work is queued. The pinned scheduler can itself
        // leak work after allocation on create/queue failure; its retained charge
        // then still represents real retained bytes. Environment teardown cannot
        // promise successful Node-API calls; never panic across the FFI boundary.
        let _ = self.release();
    }
}
