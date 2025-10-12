const express = require('express');
const mongoose = require('mongoose');
const User = require('./models/User'); // Import your User model

const app = express();
app.use(express.json());

// Connect to MongoDB
mongoose.connect('mongodb://localhost:27017/your-database')
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => console.log('❌ MongoDB Error:', err));

// Signup route with console logs
app.post('/signup', async (req, res) => {
    try {
        console.log('📨 Received signup request:', req.body);

        const { name, email, password } = req.body;

        // Log extracted data
        console.log('📝 Extracted data - Name:', name);
        console.log('📝 Extracted data - Email:', email);
        console.log('📝 Extracted data - Password:', password);

        // Check if user exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            console.log('❌ User already exists with email:', email);
            return res.status(400).json({
                success: false,
                message: 'User already exists'
            });
        }

        console.log('✅ Creating new user...');

        // Create new user
        const newUser = new User({
            name,
            email,
            password
        });

        // Save user (this will trigger your validations)
        await newUser.save();
        
        console.log('✅ User saved successfully:', {
            id: newUser._id,
            name: newUser.name,
            email: newUser.email
        });

        res.status(201).json({
            success: true,
            message: 'User registered successfully'
        });

    } catch (error) {
        console.error('❌ Signup error:', error.message);

        // Handle validation errors
        if (error.name === 'ValidationError') {
            const errors = Object.values(error.errors).map(err => err.message);
            console.log('❌ Validation errors:', errors);
            
            return res.status(400).json({
                success: false,
                message: errors.join(', ')
            });
        }

        // Handle duplicate email error
        if (error.code === 11000) {
            console.log('❌ Duplicate email error');
            return res.status(400).json({
                success: false,
                message: 'Email already exists'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// Start server
app.listen(3000, () => {
    console.log('🚀 Server running on http://localhost:3000');
    console.log('📍 Signup endpoint: POST http://localhost:3000/signup');
});