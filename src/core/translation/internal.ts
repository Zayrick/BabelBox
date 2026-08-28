/** 站点适配器对祖先节点给出的最小决策形状。 */
export interface AncestorAdapterDecision {
    decision: {
        kind: string;
        reason?: string;
    };
    adapterId?: string;
}

export interface AdapterPrunedAncestorResult<T> {
    result: {reason: string; adapterId?: string} | null;
    inspected: T[];
}

/** 从祖先缓存继承布尔标记；null 表示已经到达当前 DOM 树边界。 */
export function inheritCachedFlag<T extends object>(
    current: T | null,
    flags: WeakMap<T, boolean>,
): boolean {
    if (current === null) return false;
    return flags.get(current) === true;
}

/** 优先读取本轮缓存，缺失时才执行后备计算。 */
export function readCachedFlagOr<T extends object>(
    flags: WeakMap<T, boolean>,
    key: T,
    fallback: () => boolean,
): boolean {
    const cached = flags.get(key);
    if (cached !== undefined) return cached;
    return fallback();
}

/**
 * 在有界祖先链中查找站点适配器的 prune 决策。
 *
 * 该函数自己持有深度上限，不依赖调用方预先截断祖先链。
 */
export function findAdapterPrunedAncestor<T>(
    ancestors: Iterable<T>,
    maximumDepth: number,
    decide: (ancestor: T) => AncestorAdapterDecision,
): AdapterPrunedAncestorResult<T> {
    const inspected: T[] = [];
    let depth = 0;

    for (const ancestor of ancestors) {
        depth += 1;
        if (depth > maximumDepth) {
            return {result: {reason: 'ancestor-depth-limit'}, inspected};
        }

        inspected.push(ancestor);
        const {decision, adapterId} = decide(ancestor);
        if (decision.kind === 'prune-subtree') {
            return {
                result: {reason: decision.reason || 'adapter-pruned', adapterId},
                inspected,
            };
        }
    }

    return {result: null, inspected};
}

/**
 * 按不可移动的子树边界切分一个直接行内节点序列；边界节点本身由独立候选负责。
 */
export function partitionInlineRunAtBarriers<T>(
    nodes: readonly T[],
    isBarrier: (node: T) => boolean,
): T[][] {
    const partitions: T[][] = [];
    let current: T[] = [];
    const flush = () => {
        if (current.length > 0) partitions.push(current);
        current = [];
    };

    for (const node of nodes) {
        if (isBarrier(node)) {
            flush();
            continue;
        }
        current.push(node);
    }
    flush();
    return partitions;
}
