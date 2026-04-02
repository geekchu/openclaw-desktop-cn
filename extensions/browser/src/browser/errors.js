import { SsrFBlockedError } from "../infra/net/ssrf.js";
import { InvalidBrowserNavigationUrlError } from "./navigation-guard.js";
export class BrowserError extends Error {
    status;
    constructor(message, status = 500, options) {
        super(message, options);
        this.name = new.target.name;
        this.status = status;
    }
}
export class BrowserValidationError extends BrowserError {
    constructor(message, options) {
        super(message, 400, options);
    }
}
export class BrowserConfigurationError extends BrowserError {
    constructor(message, options) {
        super(message, 400, options);
    }
}
export class BrowserTargetAmbiguousError extends BrowserError {
    constructor(message = "ambiguous target id prefix", options) {
        super(message, 409, options);
    }
}
export class BrowserTabNotFoundError extends BrowserError {
    constructor(message = "tab not found", options) {
        super(message, 404, options);
    }
}
export class BrowserProfileNotFoundError extends BrowserError {
    constructor(message, options) {
        super(message, 404, options);
    }
}
export class BrowserConflictError extends BrowserError {
    constructor(message, options) {
        super(message, 409, options);
    }
}
export class BrowserResetUnsupportedError extends BrowserError {
    constructor(message, options) {
        super(message, 400, options);
    }
}
export class BrowserProfileUnavailableError extends BrowserError {
    constructor(message, options) {
        super(message, 409, options);
    }
}
export class BrowserResourceExhaustedError extends BrowserError {
    constructor(message, options) {
        super(message, 507, options);
    }
}
export function toBrowserErrorResponse(err) {
    if (err instanceof BrowserError) {
        return { status: err.status, message: err.message };
    }
    if (err instanceof SsrFBlockedError) {
        return { status: 400, message: err.message };
    }
    if (err instanceof InvalidBrowserNavigationUrlError ||
        (err instanceof Error && err.name === "InvalidBrowserNavigationUrlError")) {
        return { status: 400, message: err.message };
    }
    return null;
}
