# Siau Server

Express.js server with authentication (JWT-based signup/signin).

## Project Structure

```
siau-server/
├── server.js           # Main application entry point
├── config/             # Configuration files
│   └── database.js     # MongoDB connection setup
├── models/             # Data models (Mongoose schemas)
│   ├── User.js         # User model with schema
│   ├── Brand.js        # Brand model with schema
│   └── OverlayElement.js # Overlay element model
├── routes/             # Route definitions
│   ├── index.js        # Main router (aggregates all routes)
│   ├── authRoutes.js   # Authentication routes
│   ├── brandRoutes.js  # Brand routes
│   └── overlayRoutes.js # Overlay element routes
├── actions/            # Controller/Action handlers
│   ├── authActions.js  # Authentication actions (signup, signin, etc.)
│   ├── brandActions.js # Brand actions (CRUD operations)
│   └── overlayActions.js # Overlay element actions (CRUD operations)
├── middleware/         # Custom middleware
│   └── auth.js         # JWT authentication middleware
└── package.json
```

## Architecture

- **Config** (`/config`): Configuration files (database connection, etc.)
- **Models** (`/models`): Mongoose schemas and data models
- **Routes** (`/routes`): Route definitions - maps URLs to actions
- **Actions** (`/actions`): Business logic - handles requests and responses
- **Middleware** (`/middleware`): Reusable middleware functions

## API Endpoints

### Public Routes
- `GET /` - Welcome message
- `GET /api/health` - Health check
- `POST /api/auth/signup` - User registration
- `POST /api/auth/signin` - User login

### Protected Routes (require JWT token)
- `GET /api/auth/me` - Get current user profile

### Brand Routes (require JWT token)
- `POST /api/brands` - Create a new brand
- `GET /api/brands` - Get all brands for the user
- `GET /api/brands/default` - Get the default brand
- `GET /api/brands/:id` - Get a specific brand by ID
- `PUT /api/brands/:id` - Update a brand
- `PUT /api/brands/:id/set-default` - Set a brand as default
- `DELETE /api/brands/:id` - Delete a brand

### Overlay Element Routes (require JWT token)
- `POST /api/overlay` - Create a new overlay element (requires brandId)
- `GET /api/overlay` - Get all overlay elements (optional: ?brandId=xxx)
- `GET /api/overlay/:id` - Get a specific overlay element by ID
- `PUT /api/overlay/:id` - Update an overlay element by ID
- `DELETE /api/overlay/:id` - Delete an overlay element by ID

## Data Relationships

- **User → Brands**: One-to-Many (each user can have multiple brands)
- **Brand → Overlay Elements**: One-to-Many (each brand can have multiple overlay elements)
- **Default Brand**: Each user has one default brand

## Getting Started

### Prerequisites
- Node.js (v14 or higher)
- MongoDB (local installation or MongoDB Atlas)

### Install Dependencies
```bash
npm install
```

### Setup MongoDB
You have two options:

**Option 1: Local MongoDB**
1. Install MongoDB locally: https://www.mongodb.com/docs/manual/installation/
2. Start MongoDB service:
   ```bash
   # macOS (using Homebrew)
   brew services start mongodb-community
   
   # or run manually
   mongod
   ```

**Option 2: MongoDB Atlas (Cloud)**
1. Create a free account at https://www.mongodb.com/cloud/atlas
2. Create a cluster and get your connection string
3. Update MONGODB_URI in your .env file

### Configure Environment Variables
Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```

Update the values:
```
PORT=3000
JWT_SECRET=your-secure-secret-key
MONGODB_URI=mongodb://localhost:27017/siau-server
# or for MongoDB Atlas:
# MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/siau-server
```

### Run Server
```bash
npm start
```

### Development Mode (with nodemon)
```bash
npm run dev
```

## Authentication

The API uses JWT (JSON Web Tokens) for authentication.

### Signup
```bash
POST /api/auth/user/signup
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123",
  "name": "John Doe"
}
```

### Signin
```bash
POST /api/auth/user/signin
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}
```

### Accessing Protected Routes
Include the JWT token in the Authorization header:
```bash
Authorization: Bearer YOUR_JWT_TOKEN
```

## Environment Variables

Create a `.env` file based on `.env.example`:
```
PORT=3000
JWT_SECRET=your-secret-key-change-this-to-something-secure
MONGODB_URI=mongodb://localhost:27017/siau-server
```

For MongoDB Atlas (cloud):
```
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/siau-server
```

## Security Notes

✅ **Production-ready features:**
- MongoDB database storage
- Password hashing with bcrypt
- JWT authentication
- Mongoose schema validation

⚠️ **Additional recommendations for production:**
- Use a proper database (MongoDB, PostgreSQL, etc.)
- Store secrets in environment variables
- Implement rate limiting
- Add refresh token mechanism
- Enable HTTPS
- Add input sanitization
- Implement logging and monitoring

## Technologies Used

- Express.js - Web framework
- MongoDB - Database
- Mongoose - MongoDB ODM
- CORS - Cross-origin resource sharing
- bcrypt - Password hashing
- jsonwebtoken - JWT authentication
- nodemon - Development auto-reload
