export class TelegramPollingTransportState {
    opts;
    #telegramTransport;
    #transportDirty = false;
    constructor(opts) {
        this.opts = opts;
        this.#telegramTransport = opts.initialTransport;
    }
    markDirty() {
        this.#transportDirty = true;
    }
    acquireForNextCycle() {
        const shouldCreateTransport = this.#transportDirty || !this.#telegramTransport;
        const nextTransport = shouldCreateTransport
            ? (this.opts.createTelegramTransport?.() ?? this.#telegramTransport)
            : this.#telegramTransport;
        if (this.#transportDirty && nextTransport) {
            this.opts.log("[telegram][diag] rebuilding transport for next polling cycle");
        }
        this.#telegramTransport = nextTransport;
        this.#transportDirty = false;
        return nextTransport;
    }
}
