import { describeImageWithModel as describeImageWithModelImpl, transcribeFirstAudio as transcribeFirstAudioImpl, } from "openclaw/plugin-sdk/media-runtime";
export async function describeImageWithModel(...args) {
    return await describeImageWithModelImpl(...args);
}
export async function transcribeFirstAudio(...args) {
    return await transcribeFirstAudioImpl(...args);
}
