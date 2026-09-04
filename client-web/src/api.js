import axios from 'axios'
import { io } from 'socket.io-client'

const api = axios.create({
  baseURL: '/api',
  timeout: 15000,
})

// 请求拦截：注入 token
api.interceptors.request.use(config => {
  const token = localStorage.getItem('client_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// 响应拦截
api.interceptors.response.use(
  res => res.data,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('client_token')
    }
    return Promise.reject(err.response?.data || err)
  }
)

// Socket.IO 单例
let socket = null
function getSocket(token) {
  if (socket?.connected) return socket
  if (socket) socket.disconnect()
  socket = io({
    auth: { token, type: 'customer' },
    transports: ['websocket', 'polling'],
  })
  return socket
}

export { api, getSocket }
export default api
