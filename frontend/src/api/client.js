import axios from "axios";

const DESKTOP_API_URL = "http://127.0.0.1:8000";
const configuredApiUrl = import.meta.env.VITE_API_URL;
const isDesktopTarget = import.meta.env.VITE_APP_TARGET !== "public";
const apiBaseUrl = (isDesktopTarget ? DESKTOP_API_URL : configuredApiUrl || DESKTOP_API_URL).replace(/\/+$/, "");

const api = axios.create({
  baseURL: apiBaseUrl,
});

export function getApiErrorMessage(error, fallbackMessage) {
  const status = error.response?.status;
  const detail = error.response?.data?.detail;
  let message = "";

  if (typeof detail === "string") {
    message = detail;
  } else if (Array.isArray(detail) && detail.length > 0) {
    message = detail.map((item) => item.msg).filter(Boolean).join(" ");
  } else if (typeof error.response?.data?.error === "string") {
    message = error.response.data.error;
  } else if (error.message) {
    message = error.message;
  }

  const baseMessage = message || fallbackMessage;

  if (status) {
    return `${fallbackMessage} HTTP ${status}: ${baseMessage}`;
  }

  if (error.request) {
    return `${fallbackMessage} No response from ${apiBaseUrl}. The backend may be unavailable, or the request may be blocked by CORS/WebView origin rules.`;
  }

  return baseMessage;
}

export { apiBaseUrl };
export default api;
