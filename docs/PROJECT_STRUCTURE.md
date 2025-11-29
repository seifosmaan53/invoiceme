# InvoiceMe Project Structure

## 📁 Directory Overview

```
invoice-maker/
├── backend/                    # NestJS Backend API
│   ├── src/                   # Source code
│   │   ├── auth/              # Authentication module
│   │   ├── clients/           # Client management
│   │   ├── invoices/          # Invoice management
│   │   ├── payments/          # Payment processing
│   │   ├── core/              # Core services & utilities
│   │   └── entities/          # Database entities
│   ├── migrations/            # Database migrations
│   ├── test/                  # Tests
│   └── package.json          # Dependencies
│
├── mobile/                     # Flutter Mobile App
│   ├── lib/                   # Dart source code
│   │   ├── core/              # Core services & utilities
│   │   ├── models/            # Data models
│   │   ├── screens/           # UI screens
│   │   └── widgets/           # Reusable widgets
│   ├── test/                  # Tests
│   └── pubspec.yaml          # Dependencies
│
├── docs/                       # Documentation
│   ├── setup/                 # Setup guides
│   ├── implementation/        # Implementation docs
│   ├── status/                # Status reports
│   └── archive/               # Archived docs
│
├── scripts/                    # Utility scripts
│   ├── backup-database.sh     # Database backup
│   ├── restore-database.sh   # Database restore
│   └── migrate.sh             # Migration helper
│
├── k8s/                        # Kubernetes configs
│   └── deployment.yaml        # K8s deployment
│
├── docker-compose.yml          # Docker services
├── docker-compose.scale.yml   # Scaling config
├── README.md                   # Main documentation
└── CHANGELOG.md               # Version history
```

## 🎯 Key Files

### Root Level
- `README.md` - Main project documentation
- `CHANGELOG.md` - Version history
- `docker-compose.yml` - Docker services configuration
- `.gitignore` - Git ignore rules

### Backend
- `backend/src/main.ts` - Application entry point
- `backend/src/app.module.ts` - Root module
- `backend/migrations/` - Database migrations
- `backend/package.json` - Dependencies and scripts

### Mobile
- `mobile/lib/main.dart` - Application entry point
- `mobile/pubspec.yaml` - Dependencies
- `mobile/lib/models/` - Data models
- `mobile/lib/screens/` - UI screens

### Documentation
- `docs/DEVELOPER_GUIDE.md` - Developer setup
- `docs/USER_MANUAL.md` - User documentation
- `docs/DEPLOYMENT_GUIDE.md` - Deployment guide
- `docs/API_DOCUMENTATION.md` - API reference

## 🔍 Finding Files

### Backend Code
- **Controllers:** `backend/src/*/.*controller.ts`
- **Services:** `backend/src/*/.*service.ts`
- **Entities:** `backend/src/entities/`
- **DTOs:** `backend/src/*/dto/`

### Mobile Code
- **Screens:** `mobile/lib/screens/`
- **Models:** `mobile/lib/models/`
- **Widgets:** `mobile/lib/widgets/`
- **Services:** `mobile/lib/core/services/`

### Documentation
- **Setup:** `docs/setup/`
- **Implementation:** `docs/implementation/`
- **Status:** `docs/status/`

## 📝 File Naming Conventions

- **Backend:** kebab-case (e.g., `invoice-item.dto.ts`)
- **Mobile:** snake_case (e.g., `invoice_item.dart`)
- **Documentation:** UPPER_SNAKE_CASE (e.g., `API_DOCUMENTATION.md`)

## 🚀 Quick Navigation

- Start here: [README.md](README.md)
- Setup: [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md)
- API: [docs/API_DOCUMENTATION.md](docs/API_DOCUMENTATION.md)
- Deployment: [docs/DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md)
