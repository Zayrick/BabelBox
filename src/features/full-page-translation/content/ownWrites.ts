interface MutationSink {
    observer: MutationObserver;
    handle(records: MutationRecord[]): void;
}

let sink: MutationSink | null = null;

export function setMutationSink(next: MutationSink | null): void {
    sink = next;
}

/**
 * 执行插件自身的同步 DOM 写入，并让全文会话的 MutationObserver 忽略它们。
 * 写入前先把已排队的宿主记录交给会话处理，写入后再丢弃新产生的记录，
 * 因此被丢弃的只可能是本次写入；插件不再需要按文本或属性值猜测
 * 某条 mutation 是不是自己造成的。
 */
export function ownWrite<T>(write: () => T): T {
    const current = sink;
    if (!current) return write();
    const pending = current.observer.takeRecords();
    if (pending.length > 0) current.handle(pending);
    try {
        return write();
    } finally {
        if (sink === current) current.observer.takeRecords();
    }
}
