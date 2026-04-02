export function isMatrixDeviceLocallyVerified(status) {
    return status?.localVerified === true;
}
export function isMatrixDeviceOwnerVerified(status) {
    return status?.crossSigningVerified === true || status?.signedByOwner === true;
}
export function isMatrixDeviceVerifiedInCurrentClient(status) {
    return (status?.isVerified?.() === true ||
        isMatrixDeviceLocallyVerified(status) ||
        isMatrixDeviceOwnerVerified(status));
}
