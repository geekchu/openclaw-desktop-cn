import { transcribeFirstAudio as transcribeFirstAudioImpl } from "openclaw/plugin-sdk/media-runtime";
export async function transcribeFirstAudio(...args) {
    return await transcribeFirstAudioImpl(...args);
}
