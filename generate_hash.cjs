const bcrypt = require ('bcrypt');

const password = 'Usuario123'; // <-- ¡CAMBIA ESTO!
const saltRounds = 10;

bcrypt.hash(password, saltRounds, function(err, hash) {
    if (err) throw err;
    console.log(`COPIA ESTE HASH COMPLETO: ${hash}`);
});

// INSERT INTO users (nombre, email, password, rol) 
// VALUES ('Nuevo Operador', 'nuevo.usuario@asesoriasth.com', 'HASH_DE_BCRYPT_AQUI'