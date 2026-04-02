export function defineCachedValue(target, key, create) {
    let cached;
    let ready = false;
    Object.defineProperty(target, key, {
        configurable: true,
        enumerable: true,
        get() {
            if (!ready) {
                cached = create();
                ready = true;
            }
            return cached;
        },
    });
}
