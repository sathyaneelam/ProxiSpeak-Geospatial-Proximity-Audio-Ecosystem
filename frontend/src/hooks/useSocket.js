
import { useEffect, useRef, useState, useCallback } from 'react'
import { io } from 'socket.io-client'

const SERVER_URL =
  import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001'

export function useSocket() {
  const socketRef = useRef(null)
  const [isConnected, setIsConnected] = useState(false)
  const [connectionError, setConnectionError] = useState(null)

  useEffect(() => {
    const socket = io(SERVER_URL, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 5,
    })

    socketRef.current = socket

    const handleConnect = () => {
      setIsConnected(true)
      setConnectionError(null)
      console.log('Connected to ProxiSpeak backend')
    }

    const handleDisconnect = () => {
      setIsConnected(false)
    }

    const handleError = (error) => {
      setIsConnected(false)
      setConnectionError(error.message)
    }

    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('connect_error', handleError)

    return () => {
      socket.removeAllListeners()
      socket.disconnect()
      socketRef.current = null
    }
  }, [])

  const joinOffice = useCallback((officeId) => {
    if (!socketRef.current?.connected) return false

    socketRef.current.emit('join-office', { officeId })
    return true
  }, [])

  const moveAvatar = useCallback((officeId, x, y) => {
    if (!socketRef.current?.connected) return false

    socketRef.current.emit('move-avatar', {
      officeId,
      x,
      y,
    })
    return true
  }, [])

  return {
    socketRef,
    isConnected,
    connectionError,
    joinOffice,
    moveAvatar,
  }
}
