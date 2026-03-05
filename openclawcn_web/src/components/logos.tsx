/* Inline SVG logos — eliminates ~24 HTTP requests on initial load.
   Total size ~15KB, negligible compared to a single extra round-trip. */

import { type SVGProps, type ReactNode } from "react";

type P = SVGProps<SVGSVGElement>;

// ── Hero ──

export function OpenClawLogo(p: P) {
  return (
    <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" {...p}>
      <defs>
        <linearGradient id="lobster-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ff7079" />
          <stop offset="100%" stopColor="#ea4c59" />
        </linearGradient>
      </defs>
      <path
        d="M60 10 C30 10 15 35 15 55 C15 75 30 95 45 100 L45 110 L55 110 L55 100 C55 100 60 102 65 100 L65 110 L75 110 L75 100 C90 95 105 75 105 55 C105 35 90 10 60 10Z"
        fill="url(#lobster-grad)"
      />
      <path
        d="M20 45 C5 40 0 50 5 60 C10 70 20 65 25 55 C28 48 25 45 20 45Z"
        fill="url(#lobster-grad)"
      />
      <path
        d="M100 45 C115 40 120 50 115 60 C110 70 100 65 95 55 C92 48 95 45 100 45Z"
        fill="url(#lobster-grad)"
      />
      <path d="M45 15 Q35 5 30 8" stroke="#ef4b58" strokeWidth="2" strokeLinecap="round" />
      <path d="M75 15 Q85 5 90 8" stroke="#ef4b58" strokeWidth="2" strokeLinecap="round" />
      <circle cx="45" cy="35" r="6" fill="#1a1a2e" />
      <circle cx="75" cy="35" r="6" fill="#1a1a2e" />
      <circle cx="46" cy="34" r="2" fill="#00e5cc" />
      <circle cx="76" cy="34" r="2" fill="#00e5cc" />
    </svg>
  );
}

// ── AI Models ──

export function OpenAILogo(p: P) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none" {...p}>
      <circle cx="20" cy="20" r="18" fill="#000" />
      <path
        d="M20 8C13.4 8 8 13.4 8 20s5.4 12 12 12c2.2 0 4.2-.6 6-1.6"
        stroke="#fff"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M28 12l-8 8m0 0l-4-4m4 4l4-4"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ClaudeLogo(p: P) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none" {...p}>
      <rect width="40" height="40" rx="8" fill="#D97706" />
      <path
        d="M20 10c-5.5 0-10 4.5-10 10s4.5 10 10 10c3.3 0 6.2-1.6 8-4"
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

export function GeminiLogo(p: P) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none" {...p}>
      <rect width="40" height="40" rx="8" fill="#1A73E8" />
      <path d="M20 6l3.5 7.5L31 15l-5.5 5.5L27 29l-7-4-7 4 1.5-8.5L9 15l7.5-1.5z" fill="#fff" />
    </svg>
  );
}

export function DeepSeekLogo(p: P) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none" {...p}>
      <rect width="40" height="40" rx="8" fill="#4D6BFE" />
      <path
        d="M12 14h6c3.3 0 6 2.7 6 6s-2.7 6-6 6h-6v-12z"
        stroke="#fff"
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M22 14h4c2.2 0 4 2.7 4 6s-1.8 6-4 6h-4"
        stroke="#fff"
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.6"
      />
    </svg>
  );
}

export function QwenLogo(p: P) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none" {...p}>
      <rect width="40" height="40" rx="8" fill="#6D28D9" />
      <circle cx="20" cy="18" r="8" stroke="#fff" strokeWidth="2.5" fill="none" />
      <path d="M25 24l3 7" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="20" cy="18" r="3" fill="#fff" />
    </svg>
  );
}

export function DoubaoLogo(p: P) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none" {...p}>
      <rect width="40" height="40" rx="8" fill="#06B6D4" />
      <rect
        x="10"
        y="12"
        width="20"
        height="16"
        rx="4"
        stroke="#fff"
        strokeWidth="2.5"
        fill="none"
      />
      <circle cx="16.5" cy="20" r="2.5" fill="#fff" />
      <circle cx="23.5" cy="20" r="2.5" fill="#fff" />
    </svg>
  );
}

export function MoonshotLogo(p: P) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none" {...p}>
      <rect width="40" height="40" rx="8" fill="#1E1B4B" />
      <path
        d="M26 12a10 10 0 1 1-12 12"
        stroke="#fff"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="20" cy="20" r="3.5" fill="#fff" />
    </svg>
  );
}

export function ZhipuLogo(p: P) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none" {...p}>
      <rect width="40" height="40" rx="8" fill="#DC2626" />
      <path d="M10 28l7-18h2l-3 9h6l-8 18h-2l3.5-9H10z" fill="#fff" />
    </svg>
  );
}

export function ErnieLogo(p: P) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none" {...p}>
      <rect width="40" height="40" rx="8" fill="#2563EB" />
      <circle cx="20" cy="20" r="9" stroke="#fff" strokeWidth="2.5" fill="none" />
      <path
        d="M15 20c0-2.8 2.2-5 5-5"
        stroke="#fff"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="20" cy="20" r="2" fill="#fff" />
      <path
        d="M20 11v-2M20 31v-2M29 20h2M9 20h2"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function MinimaxLogo(p: P) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none" {...p}>
      <rect width="40" height="40" rx="8" fill="#7C3AED" />
      <path
        d="M8 28V12l8 10 8-10v16"
        stroke="#fff"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

// ── Integration Apps ──

export function WeChatLogo(p: P) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#07C160" {...p}>
      <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 0 1-.023-.156.49.49 0 0 1 .201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.269-.03-.407-.03zm-2.53 3.274c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982zm4.844 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.969-.982z" />
    </svg>
  );
}

export function TelegramLogo(p: P) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#26A5E4" {...p}>
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}

export function DiscordLogo(p: P) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#5865F2" {...p}>
      <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
    </svg>
  );
}

export function SlackLogo(p: P) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#4A154B" {...p}>
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
    </svg>
  );
}

export function DingTalkLogo(p: P) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#0089FF" {...p}>
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 12.551l-.678.678c-.05.05-.12.078-.19.078h-2.544l-.002 2.543c0 .07-.028.14-.078.19l-.678.678a.269.269 0 01-.38 0l-.678-.678a.269.269 0 01-.078-.19v-2.543H9.974a.269.269 0 01-.19-.078l-.678-.678a.269.269 0 010-.38l.678-.678c.05-.05.12-.078.19-.078h2.614V8.822c0-.07.028-.14.078-.19l.678-.678a.269.269 0 01.38 0l.678.678c.05.05.078.12.078.19v2.614h2.544c.07 0 .14.028.19.078l.678.678a.269.269 0 010 .38z" />
    </svg>
  );
}

export function FeishuLogo(p: P) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#3370FF" {...p}>
      <path d="M6.25 4.5l10.5 7.125L6.25 19.5V4.5zm0-3a3 3 0 00-3 3v15a3 3 0 004.688 2.484l10.5-7.5a3 3 0 000-4.968l-10.5-7.5A3 3 0 006.25 1.5z" />
    </svg>
  );
}

export function WeComLogo(p: P) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#0082EF" {...p}>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15h-2v-6h2v6zm4 0h-2v-6h2v6zm0-8H9V7h6v2z" />
    </svg>
  );
}

export function GitHubLogo(p: P) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#24292f" {...p}>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

export function NotionLogo(p: P) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#000000" {...p}>
      <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952l1.448.327s0 .84-1.168.84l-3.22.186c-.094-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.14c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z" />
    </svg>
  );
}

export function GmailLogo(p: P) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#EA4335" {...p}>
      <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z" />
    </svg>
  );
}

export function CalendarLogo(p: P) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#4285F4" {...p}>
      <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2zM9 14H7v-2h2v2zm4 0h-2v-2h2v2zm4 0h-2v-2h2v2zm-8 4H7v-2h2v2zm4 0h-2v-2h2v2zm4 0h-2v-2h2v2z" />
    </svg>
  );
}

export function SpotifyLogo(p: P) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#1DB954" {...p}>
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
    </svg>
  );
}

// ── Lookup map for data-driven rendering ──

export const aiModelLogos: Record<string, (p: P) => ReactNode> = {
  "/logos/openai.svg": OpenAILogo,
  "/logos/claude.svg": ClaudeLogo,
  "/logos/gemini.svg": GeminiLogo,
  "/logos/deepseek.svg": DeepSeekLogo,
  "/logos/qwen.svg": QwenLogo,
  "/logos/doubao.svg": DoubaoLogo,
  "/logos/moonshot.svg": MoonshotLogo,
  "/logos/zhipu.svg": ZhipuLogo,
  "/logos/ernie.svg": ErnieLogo,
  "/logos/minimax.svg": MinimaxLogo,
};

export const appLogos: Record<string, (p: P) => ReactNode> = {
  "/logos/wechat.svg": WeChatLogo,
  "/logos/telegram.svg": TelegramLogo,
  "/logos/discord.svg": DiscordLogo,
  "/logos/slack.svg": SlackLogo,
  "/logos/dingtalk.svg": DingTalkLogo,
  "/logos/feishu.svg": FeishuLogo,
  "/logos/wecom.svg": WeComLogo,
  "/logos/github.svg": GitHubLogo,
  "/logos/notion.svg": NotionLogo,
  "/logos/gmail.svg": GmailLogo,
  "/logos/calendar.svg": CalendarLogo,
  "/logos/spotify.svg": SpotifyLogo,
};
