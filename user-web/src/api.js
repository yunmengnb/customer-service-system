// 忆梦云团队开发
import axios from 'axios'
const api = axios.create({ baseURL: '/api', timeout: 15000 })

function isSameOriginApiRequest(config) {
  const url = config.url || ''
  const requestUrl = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(url) || url.startsWith('//')
    ? url
    : `${String(config.baseURL || '').replace(/\/$/, '')}/${url.replace(/^\//, '')}`, window.location.origin)
  return requestUrl.origin === window.location.origin && /^\/api(?:\/|$)/.test(requestUrl.pathname)
}

api.interceptors.request.use(config => {
  const impersonating = sessionStorage.getItem('tenant_impersonation') === '1'
  const token = sessionStorage.getItem('tenant_token') || (!impersonating ? localStorage.getItem('tenant_token') : '')
  if (token && isSameOriginApiRequest(config)) config.headers.Authorization = `Bearer ${token}`
  return config
})
api.interceptors.response.use(
  res => res.data,
  err => {
    if (err.response?.status === 401) {
      if (sessionStorage.getItem('tenant_impersonation') === '1') {
        sessionStorage.removeItem('tenant_token')
        sessionStorage.removeItem('tenant_user')
        sessionStorage.removeItem('tenant_info')
      } else {
        const storage = sessionStorage.getItem('tenant_token') ? sessionStorage : localStorage
        storage.removeItem('tenant_token')
      }
    }
    const reason = err.response?.data || err
    if (reason && typeof reason === 'object') reason.httpStatus = err.response?.status
    return Promise.reject(reason)
  }
)

// FormData 上传（axios.post 传 FormData 即可，但要确保 Content-Type 被自动设置）
api.upload = function(url, formData, extraHeaders = {}) {
  return api.post(url, formData, {
    headers: { 'Content-Type': 'multipart/form-data', ...extraHeaders },
    timeout: 30000,
  })
}

export default api
