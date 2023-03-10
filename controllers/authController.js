const crypto = require('crypto');
const { promisify } = require('util');
const jwt = require('jsonwebtoken');
const User = require('../models/userModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');


const signToken = id => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN
    });
};

const createSendToken = (user, statusCode, res) => {
    const token = signToken(user._id);
    const cookieOptions = {
        expires: new Date(
            Date.now() + process.env.JWT_COOKIE_EXPIRES_IN * 24 * 60 * 60 * 1000
        ),
        httpOnly: true
    };
    if (process.env.NODE_ENV === 'production') cookieOptions.secure = true;

    res.cookie('jwt', token, cookieOptions);

    // Remove password from output
    user.password = undefined;

    res.status(statusCode).json({
        status: 'success',
        token,
        role: user.role,
        fname: user.fname,
        data: {
            user
        }
    });
};

exports.signup = catchAsync(async (req, res, next) => {
    const newUser = await User.create(req.body);

    // Remove password from output
    newUser.password = undefined;

    res.status(200).json({
        status: 'success',
        data: {
            newUser
        }
    });
});


exports.login = catchAsync(async (req, res, next) => {
    const { email, password } = req.body;

    // 1) Check if email and password exist
    if (!email || !password) {
        return next(new AppError('Veuillez spécifier un email et un mot de passe !', 400));
    }
    // 2) Check if user exists && password is correct
    const user = await User.findOne({ email }).select('+password');

    if (!user || !(await user.correctPassword(password, user.password))) {
        return next(new AppError('Email ou mot de passe incorrect.', 401));
    }


    // 3) If everything ok, send token to client
    createSendToken(user, 200, res);
});

exports.logout = (req, res) => {
    res.cookie('jwt', 'loggedout', {
        expires: new Date(Date.now() + 10 * 1000),
        httpOnly: true
    });
    res.status(200).json({ status: 'success' });
};



exports.protect = catchAsync(async (req, res, next) => {
    // 1) Getting token and check of it's there
    let token;
    if (
        req.headers.authorization &&
        req.headers.authorization.startsWith('Bearer')
    ) {
        token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies.jwt) {
        token = req.cookies.jwt;
    }

    if (!token) {
        return next(
            new AppError('Vous n\'êtes pas connecté. Veuillez vous connecter pour accéder à la ressource.', 401)
        );
    }

    // 2) Verification token
    const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);

    // 3) Check if user still exists
    const currentUser = await User.findById(decoded.id);
    if (!currentUser) {
        return next(
            new AppError(
                'L\'utilisateur appartenant à ce token n\'existe plus. Veuillez vous reconnecter.',
                401
            )
        );
    }

    // 4) Check if user changed password after the token was issued
    if (currentUser.changedPasswordAfter(decoded.iat)) {
        return next(
            new AppError('Votre mot de passe à été modifié. Veuillez vous reconnecter', 401)
        );
    }

    // GRANT ACCESS TO PROTECTED ROUTE
    req.user = currentUser;
    res.locals.user = currentUser;
    next();
});










// Only for rendered pages, no errors!
exports.isLoggedIn = async (req, res, next) => {
    if (req.cookies.jwt) {
        try {
            // 1) verify token
            const decoded = await promisify(jwt.verify)(
                req.cookies.jwt,
                process.env.JWT_SECRET
            );

            // 2) Check if user still exists
            const currentUser = await User.findById(decoded.id);
            if (!currentUser) {
                return next();
            }

            // 3) Check if user changed password after the token was issued
            if (currentUser.changedPasswordAfter(decoded.iat)) {
                return next();
            }

            // THERE IS A LOGGED IN USER
            res.locals.user = currentUser;
            return next();
        } catch (err) {
            return next();
        }
    }
    next();
};

exports.restrictTo = (...roles) => {
    return (req, res, next) => {
        // roles ['admin', 'chief', 'employee']. role='user'
        if (!roles.includes(req.user.role)) {
            return next(
                new AppError('Vous n\'avez pas le droit d\'effectuer cette action !', 403)
            );
        }

        next();
    };
};






// exports.forgotPassword = catchAsync(async (req, res, next) => {
//     // 1) Get user based on POSTed email
//     const user = await User.findOne({ email: req.body.email });
//     if (!user) {
//         return next(new AppError('Aucun utilisateur n\'est relié à cette adresse mail.', 404));
//     }

//     // 2) Generate the random reset token
//     const resetToken = user.createPasswordResetToken();
//     await user.save({ validateBeforeSave: false });

//     // 3) Send it to user's email
//     const resetURL = `${req.protocol}://${req.get(
//         'host'
//     )}/api/v1/users/resetPassword/${resetToken}`;

//     const message = `Forgot your password? Submit a PATCH request with your new password and passwordConfirm to: ${resetURL}.\nIf you didn't forget your password, please ignore this email!`;

//     try {
//         await sendEmail({
//             email: user.email,
//             subject: 'Your password reset token (valid for 10 min)',
//             message
//         });

//         res.status(200).json({
//             status: 'success',
//             message: 'Token envoyé dans votre boîte mail !'
//         });
//     } catch (err) {
//         user.passwordResetToken = undefined;
//         user.passwordResetExpires = undefined;
//         await user.save({ validateBeforeSave: false });

//         return next(
//             new AppError('Une erreur est survenur lors de l\'envoi de l\'email. Veuillez réessayer.'),
//             500
//         );
//     }
// });

// exports.resetPassword = catchAsync(async (req, res, next) => {
//     // 1) Get user based on the token
//     const hashedToken = crypto
//         .createHash('sha256')
//         .update(req.params.token)
//         .digest('hex');

//     const user = await User.findOne({
//         passwordResetToken: hashedToken,
//         passwordResetExpires: { $gt: Date.now() }
//     });

//     // 2) If token has not expired, and there is user, set the new password
//     if (!user) {
//         return next(new AppError('Votre token est invalide ou expiré. Veuillez réessayer.', 400));
//     }
//     user.password = req.body.password;
//     user.passwordConfirm = req.body.passwordConfirm;
//     user.passwordResetToken = undefined;
//     user.passwordResetExpires = undefined;
//     await user.save();

//     // 3) Update changedPasswordAt property for the user
//     // 4) Log the user in, send JWT
//     createSendToken(user, 200, res);
// });

// exports.updatePassword = catchAsync(async (req, res, next) => {
//     // 1) Get user from collection
//     const user = await User.findById(req.user.id).select('+password');

//     // 2) Check if POSTed current password is correct
//     if (!(await user.correctPassword(req.body.passwordCurrent, user.password))) {
//         return next(new AppError('Votre mot de passe actuel n\'est pas correcte.', 401));
//     }

//     // 3) If so, update password
//     user.password = req.body.password;
//     user.passwordConfirm = req.body.passwordConfirm;
//     await user.save();
//     // User.findByIdAndUpdate will NOT work as intended!

//     // 4) Log user in, send JWT
//     createSendToken(user, 200, res);
// });
