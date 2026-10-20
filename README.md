# ProxiSpeak-Geospatial-Proximity-Audio-Ecosystem
ProxiSpeak: Geospatial Proximity Audio Ecosystem - A web development internship project focused on building responsive web applications, integrating APIs and databases, and developing proximity-based audio features.
## Real-Time Avatar Movement

ProxiSpeak uses Socket.IO to synchronize avatar positions between connected users. When an avatar moves, the client sends its updated coordinates to the backend using the `avatar:move` event. The server processes the movement and broadcasts the updated position using the `avatar:moved` event. This helps users see other avatars move in real time within the virtual office.

## Backend API and Avatar Synchronization

The ProxiSpeak backend uses Node.js, Express.js, MongoDB, and Socket.IO. The position API stores avatar coordinates, while the office API creates virtual office records. Socket.IO handles real-time avatar movement by receiving updated coordinates and broadcasting movement events to connected users. These features support synchronization between participants in the virtual office.