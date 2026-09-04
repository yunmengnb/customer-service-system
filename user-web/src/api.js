import axios from 'axios'
const api = axios.create({ baseURL: '/api', timeout: 15000 })

api.interceptors.request.use(config => {
  const token = sessionStorage.getItem('tenant_token') || localStorage.getItem('tenant_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})
api.interceptors.response.use(
  res => res.data,
  err => {
    if (err.response?.status === 401) {
      const storage = sessionStorage.getItem('tenant_token') ? sessionStorage : localStorage
      storage.removeItem('tenant_token')
    }
    return Promise.reject(err.response?.data || err)
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
