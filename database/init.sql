-- backend/database/init.sql
CREATE DATABASE IF NOT EXISTS nafassante;
USE nafassante;

-- ==================== TABLE USERS ====================
CREATE TABLE users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    role ENUM('agent', 'admin') NOT NULL,
    region VARCHAR(100),
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_email (email),
    INDEX idx_role (role),
    INDEX idx_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==================== TABLE PATIENTS ====================
CREATE TABLE patients (
    id INT PRIMARY KEY AUTO_INCREMENT,
    local_id VARCHAR(50),
    name VARCHAR(100) NOT NULL,
    sex ENUM('M', 'F') NOT NULL,
    birth_date DATE NOT NULL,
    phone VARCHAR(20) NOT NULL,
    address TEXT,
    locality VARCHAR(100) NOT NULL,
    blood_type VARCHAR(5),
    emergency_contact VARCHAR(100),
    emergency_phone VARCHAR(20),
    created_by INT,
    synced BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_local_id (local_id),
    INDEX idx_synced (synced)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==================== TABLE CONSULTATIONS ====================
CREATE TABLE consultations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    patientId INT NOT NULL,
    agentId INT,
    date DATE NOT NULL,
    symptoms JSON,
    diagnosis TEXT,
    treatment TEXT,
    weight DECIMAL(5,2),
    temperature DECIMAL(4,1),
    bloodPressure VARCHAR(20),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patientId) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (agentId) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_patientId (patientId),
    INDEX idx_agentId (agentId),
    INDEX idx_date (date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==================== TABLE PREGNANCIES ====================
CREATE TABLE pregnancies (
    id INT PRIMARY KEY AUTO_INCREMENT,
    patientId INT NOT NULL,
    agentId INT,
    startDate DATE,
    lastMenstrualPeriod DATE,
    expectedDeliveryDate DATE,
    status ENUM('active', 'delivered', 'miscarriage', 'complicated') DEFAULT 'active',
    complications JSON,
    deliveryDate DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patientId) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (agentId) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_patientId (patientId),
    INDEX idx_agentId (agentId),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==================== TABLE VACCINATIONS ====================
CREATE TABLE vaccinations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    patientId INT NOT NULL,
    agentId INT,
    vaccineName VARCHAR(100) NOT NULL,
    doseNumber INT DEFAULT 1,
    dateAdministered DATE NOT NULL,
    nextDoseDate DATE,
    batchNumber VARCHAR(50),
    location VARCHAR(100),
    observations TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patientId) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (agentId) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_patientId (patientId),
    INDEX idx_agentId (agentId),
    INDEX idx_vaccineName (vaccineName),
    INDEX idx_dateAdministered (dateAdministered)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==================== TABLE VACCINE_STOCK ====================
CREATE TABLE vaccine_stock (
    id INT PRIMARY KEY AUTO_INCREMENT,
    vaccineId VARCHAR(50) NOT NULL,
    vaccineName VARCHAR(100) NOT NULL,
    month VARCHAR(7) NOT NULL, -- Format: YYYY-MM
    year INT NOT NULL,
    monthNumber INT NOT NULL, -- 1-12
    initialStock INT DEFAULT 0,
    received INT DEFAULT 0,
    used INT DEFAULT 0,
    remaining INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_vaccine_month (vaccineId, month),
    INDEX idx_month (month),
    INDEX idx_vaccineId (vaccineId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;