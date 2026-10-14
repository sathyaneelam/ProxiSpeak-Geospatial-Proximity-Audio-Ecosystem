
import { useEffect, useRef, useState, useCallback } from 'react'
import { io } from 'socket.io-client'

const SERVER_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000'

export function useSocket() {
  const socketRef = useRef(null)
  const [isConnected, setIsConnected] = useState(false)
  const [connectionError, setConnectionError] = useState(null)

  useEffect(() => {
    const socket = io(SERVER_URL, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    })

    socketRef.current = socket

    socket.on('connect', () => {
      setIsConnected(true)
      setConnectionError(null)
    })

    socket.on('disconnect', (reason) => {
      setIsConnected(false)
      setConnectionError(`Disconnected: ${reason}`)
    })

    socket.on('connect_error', (error) => {
      setIsConnected(false)
      setConnectionError(error.message)
    })

    socket.on('error', (error) => {
      setConnectionError(error?.message || 'Backend error')
    })

    const heartbeat = setInterval(() => {
      if (socket.connected) {
        socket.emit('avatar:heartbeat')
      }
    }, 20000)

    return () => {
      clearInterval(heartbeat)
      socket.removeAllListeners()
      socket.disconnect()

      if (socketRef.current === socket) {
        socketRef.current = null
      }
    }
  }, [])

  const joinOffice = useCallback((
    officeId,
    x = 500,
    y = 300,
    displayName = 'Guest',
    avatarColor = '#22d3ee'
  ) => {
    if (!socketRef.current?.connected) return false

    socketRef.current.emit('office:join', {
      officeId,
      x,
      y,
      displayName: String(displayName).trim().slice(0, 20) || 'Guest',
      avatarColor,
      earshotRadius: 100,
    })

    return true
  }, [])

  const moveAvatar = useCallback((officeId, x, y) => {
    if (!socketRef.current?.connected) return false

    socketRef.current.emit('avatar:move', {
      officeId,
      x,
      y,
    })

    return true
  }, [])

  const leaveOffice = useCallback(() => {
    if (!socketRef.current?.connected) return false

    socketRef.current.emit('office:leave')
    return true
  }, [])

  return {
    socketRef,
    isConnected,
    connectionError,
    joinOffice,
    moveAvatar,
    leaveOffice,
  }
}
