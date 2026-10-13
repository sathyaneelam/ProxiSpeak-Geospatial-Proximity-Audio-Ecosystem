
import { useEffect, useRef, useState, useCallback } from 'react'
import { io } from 'socket.io-client'

const SERVER_URL =
  import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000'

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

    const handleConnect = () => {
      setIsConnected(true)
      setConnectionError(null)
      console.log('Connected to ProxiSpeak backend:', socket.id)
    }

    const handleDisconnect = (reason) => {
      setIsConnected(false)
      setConnectionError(`Disconnected: ${reason}`)
    }

    const handleConnectError = (error) => {
      setIsConnected(false)
      setConnectionError(error.message)
    }

    const handleServerError = (error) => {
      setConnectionError(error?.message || 'Unknown server error')
    }

    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('connect_error', handleConnectError)
    socket.on('error', handleServerError)

    const heartbeatInterval = setInterval(() => {
      if (socket.connected) {
        socket.emit('avatar:heartbeat')
      }
    }, 20000)

    return () => {
      clearInterval(heartbeatInterval)
      socket.removeAllListeners()
      socket.disconnect()

      if (socketRef.current === socket) {
        socketRef.current = null
      }
    }
  }, [])

  // Supports username customization and existing avatar position.
  const joinOffice = useCallback(
    (officeId, x = 500, y = 300, displayName = 'Guest') => {
      const socket = socketRef.current
      if (!socket?.connected) return false

      socket.emit('office:join', {
        officeId,
        x,
        y,
        displayName: String(displayName).trim().slice(0, 24) || 'Guest',
        earshotRadius: 100,
      })

      return true
    },
    []
  )

  const moveAvatar = useCallback((officeId, x, y) => {
    const socket = socketRef.current
    if (!socket?.connected) return false

    socket.emit('avatar:move', { officeId, x, y })
    return true
  }, [])

  const leaveOffice = useCallback(() => {
    const socket = socketRef.current
    if (!socket?.connected) return false

    socket.emit('office:leave')
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
