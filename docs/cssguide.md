# Comprehensive Guide to Tailwind CSS v4 and DaisyUI Components

## Table of Contents
1. [Introduction and Setup](#introduction-and-setup)
2. [Core Concepts and Architecture](#core-concepts-and-architecture)
3. [Component Implementation Guide](#component-implementation-guide)
4. [Advanced Patterns and Best Practices](#advanced-patterns-and-best-practices)
5. [Performance Optimization](#performance-optimization)
6. [Accessibility and Testing](#accessibility-and-testing)
7. [Real-World Examples](#real-world-examples)

---

## 1. Introduction and Setup

### What is Tailwind CSS v4?
Tailwind CSS v4 introduces significant improvements including:
- **New CSS Engine**: Built on the latest CSS features with improved performance
- **Container Queries**: Native support for responsive design at the component level
- **Enhanced Color System**: Improved color palette with better contrast ratios
- **Simplified Configuration**: Streamlined setup with zero-config defaults
- **Better Tree Shaking**: Smaller bundle sizes with improved dead code elimination

### What is DaisyUI?
DaisyUI is a semantic component library built on top of Tailwind CSS that provides:
- **50+ Components**: Pre-built, accessible components
- **Multiple Themes**: 30+ built-in themes with dark mode support
- **Semantic Classes**: Meaningful component names like `btn`, `card`, `modal`
- **Customization**: Easy theming and component customization
- **No JavaScript Required**: Pure CSS components

### Installation and Setup

#### Step 1: Create a New Project
```bash
# Create a new project (using Vite as example)
npm create vite@latest my-tailwind-app -- --template react-ts
cd my-tailwind-app
npm install
```

#### Step 2: Install Tailwind CSS v4 and DaisyUI
```bash
# Install Tailwind CSS v4 (alpha/beta)
npm install -D tailwindcss@next @tailwindcss/postcss@next autoprefixer

# Install DaisyUI
npm install -D daisyui@latest
```

#### Step 3: Configure Tailwind CSS
```js
// tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Custom color palette
      colors: {
        'brand': {
          50: '#f0f9ff',
          500: '#3b82f6',
          900: '#1e3a8a',
        }
      },
      // Custom spacing
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
      },
      // Custom fonts
      fontFamily: {
        'display': ['Inter', 'system-ui', 'sans-serif'],
        'body': ['Inter', 'system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [
    require('daisyui'),
  ],
  // DaisyUI configuration
  daisyui: {
    themes: [
      "light",
      "dark",
      "cupcake",
      "bumblebee",
      "emerald",
      "corporate",
      "synthwave",
      "retro",
      "cyberpunk",
      "valentine",
      "halloween",
      "garden",
      "forest",
      "aqua",
      "lofi",
      "pastel",
      "fantasy",
      "wireframe",
      "black",
      "luxury",
      "dracula",
      "cmyk",
      "autumn",
      "business",
      "acid",
      "lemonade",
      "night",
      "coffee",
      "winter",
      "dim",
      "nord",
      "sunset",
      // Custom theme
      {
        mytheme: {
          "primary": "#3b82f6",
          "secondary": "#f59e0b",
          "accent": "#10b981",
          "neutral": "#374151",
          "base-100": "#ffffff",
          "info": "#06b6d4",
          "success": "#10b981",
          "warning": "#f59e0b",
          "error": "#ef4444",
        },
      },
    ],
    darkTheme: "dark",
    base: true,
    styled: true,
    utils: true,
    prefix: "",
    logs: true,
    themeRoot: ":root",
  },
}
```

#### Step 4: Configure PostCSS
```js
// postcss.config.js
export default {
  plugins: {
    '@tailwindcss/postcss': {},
    autoprefixer: {},
  },
}
```

#### Step 5: Add Tailwind Directives
```css
/* src/index.css */
@import 'tailwindcss';

/* Custom base styles */
@layer base {
  html {
    scroll-behavior: smooth;
  }

  body {
    @apply font-body antialiased;
  }

  h1, h2, h3, h4, h5, h6 {
    @apply font-display font-semibold;
  }
}

/* Custom component styles */
@layer components {
  .btn-gradient {
    @apply bg-gradient-to-r from-primary to-secondary text-white shadow-lg hover:shadow-xl transition-all duration-300;
  }

  .card-hover {
    @apply transition-transform duration-300 hover:scale-105 hover:shadow-xl;
  }
}

/* Custom utilities */
@layer utilities {
  .text-balance {
    text-wrap: balance;
  }

  .scrollbar-hide {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }

  .scrollbar-hide::-webkit-scrollbar {
    display: none;
  }
}
```

---

## 2. Core Concepts and Architecture

### Utility-First Approach
Tailwind CSS follows a utility-first methodology where you build components using small, single-purpose classes:

```html
<!-- Traditional CSS approach -->
<div class="custom-card">
  <h2 class="custom-title">Hello World</h2>
  <p class="custom-description">This is a description</p>
</div>

<!-- Tailwind utility-first approach -->
<div class="bg-white rounded-lg shadow-md p-6 max-w-sm mx-auto">
  <h2 class="text-xl font-semibold text-gray-800 mb-2">Hello World</h2>
  <p class="text-gray-600">This is a description</p>
</div>
```

### DaisyUI Semantic Components
DaisyUI adds semantic component classes on top of Tailwind utilities:

```html
<!-- DaisyUI semantic approach -->
<div class="card w-96 bg-base-100 shadow-xl">
  <div class="card-body">
    <h2 class="card-title">Hello World</h2>
    <p>This is a description</p>
    <div class="card-actions justify-end">
      <button class="btn btn-primary">Buy Now</button>
    </div>
  </div>
</div>
```

### Responsive Design Philosophy
Tailwind CSS v4 enhances responsive design with container queries and improved breakpoint system:

```html
<!-- Traditional responsive design -->
<div class="hidden md:block lg:grid lg:grid-cols-3">
  <!-- Content -->
</div>

<!-- Container query approach (v4) -->
<div class="@container">
  <div class="grid @lg:grid-cols-2 @xl:grid-cols-3 gap-4">
    <!-- Content adapts to container size, not viewport -->
  </div>
</div>
```

### Theme System Architecture
Understanding how themes work in DaisyUI:

```css
/* DaisyUI themes use CSS custom properties */
:root[data-theme="light"] {
  --primary: 219 234 254;
  --secondary: 240 253 250;
  --accent: 254 240 138;
  /* ... other theme variables */
}

:root[data-theme="dark"] {
  --primary: 30 58 138;
  --secondary: 6 78 59;
  --accent: 161 98 7;
  /* ... other theme variables */
}
```

---

## 3. Component Implementation Guide

### 3.1 Navigation Components

#### Advanced Navbar
```jsx
// components/Navbar.jsx
import { useState, useEffect } from 'react';

const Navbar = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className={`navbar sticky top-0 z-50 transition-all duration-300 ${
      isScrolled ? 'bg-base-100/80 backdrop-blur-md shadow-sm' : 'bg-transparent'
    }`}>
      <div className="navbar-start">
        <div className="dropdown">
          <div
            tabIndex={0}
            role="button"
            className="btn btn-ghost lg:hidden"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            <svg className="w-5 h-5" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 17 14">
              <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M1 1h15M1 7h15M1 13h15"/>
            </svg>
          </div>
          {isMenuOpen && (
            <ul className="menu menu-sm dropdown-content mt-3 z-[1] p-2 shadow bg-base-100 rounded-box w-52">
              <li><a href="#home">Home</a></li>
              <li><a href="#about">About</a></li>
              <li><a href="#services">Services</a></li>
              <li><a href="#contact">Contact</a></li>
            </ul>
          )}
        </div>
        <a className="btn btn-ghost text-xl font-display font-bold">
          <span className="bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
            YourBrand
          </span>
        </a>
      </div>

      <div className="navbar-center hidden lg:flex">
        <ul className="menu menu-horizontal px-1 gap-2">
          <li><a href="#home" className="hover:text-primary transition-colors">Home</a></li>
          <li><a href="#about" className="hover:text-primary transition-colors">About</a></li>
          <li>
            <details>
              <summary className="hover:text-primary transition-colors">Services</summary>
              <ul className="p-2 w-48 shadow-lg bg-base-100">
                <li><a href="#web-design">Web Design</a></li>
                <li><a href="#development">Development</a></li>
                <li><a href="#consulting">Consulting</a></li>
              </ul>
            </details>
          </li>
          <li><a href="#contact" className="hover:text-primary transition-colors">Contact</a></li>
        </ul>
      </div>

      <div className="navbar-end gap-2">
        <label className="btn btn-ghost btn-circle swap swap-rotate">
          <input type="checkbox" className="theme-controller" value="dark" />
          <svg className="swap-off fill-current w-6 h-6" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
            <path d="M5.64,17l-.71.71a1,1,0,0,0,0,1.41,1,1,0,0,0,1.41,0l.71-.71A1,1,0,0,0,5.64,17ZM5,12a1,1,0,0,0-1-1H3a1,1,0,0,0,0,2H4A1,1,0,0,0,5,12Zm7-7a1,1,0,0,0,1-1V3a1,1,0,0,0-2,0V4A1,1,0,0,0,12,5ZM5.64,7.05a1,1,0,0,0,.7.29,1,1,0,0,0,.71-.29,1,1,0,0,0,0-1.41l-.71-.71A1,1,0,0,0,4.93,6.34Zm12,.29a1,1,0,0,0,.7-.29l.71-.71a1,1,0,1,0-1.41-1.41L17,5.64a1,1,0,0,0,0,1.41A1,1,0,0,0,17.66,7.34ZM21,11H20a1,1,0,0,0,0,2h1a1,1,0,0,0,0-2Zm-9,8a1,1,0,0,0-1,1v1a1,1,0,0,0,2,0V20A1,1,0,0,0,12,19ZM18.36,17A1,1,0,0,0,17,18.36l.71.71a1,1,0,0,0,1.41,0,1,1,0,0,0,0-1.41ZM12,6.5A5.5,5.5,0,1,0,17.5,12,5.51,5.51,0,0,0,12,6.5Zm0,9A3.5,3.5,0,1,1,15.5,12,3.5,3.5,0,0,1,12,15.5Z"/>
          </svg>
          <svg className="swap-on fill-current w-6 h-6" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
            <path d="M21.64,13a1,1,0,0,0-1.05-.14,8.05,8.05,0,0,1-3.37.73A8.15,8.15,0,0,1,9.08,5.49a8.59,8.59,0,0,1,.25-2A1,1,0,0,0,8,2.36,10.14,10.14,0,1,0,22,14.05,1,1,0,0,0,21.64,13Zm-9.5,6.69A8.14,8.14,0,0,1,7.08,5.22v.27A10.15,10.15,0,0,0,17.22,15.63a9.79,9.79,0,0,0,2.1-.22A8.11,8.11,0,0,1,12.14,19.73Z"/>
          </svg>
        </label>
        <button className="btn btn-primary btn-sm">
          Get Started
        </button>
      </div>
    </div>
  );
};

export default Navbar;
```

#### Breadcrumbs Component
```jsx
// components/Breadcrumbs.jsx
const Breadcrumbs = ({ items }) => {
  return (
    <div className="breadcrumbs text-sm">
      <ul>
        {items.map((item, index) => (
          <li key={index}>
            {item.href ? (
              <a
                href={item.href}
                className="hover:text-primary transition-colors"
              >
                {item.icon && <span className="mr-1">{item.icon}</span>}
                {item.label}
              </a>
            ) : (
              <span className="text-base-content/70">
                {item.icon && <span className="mr-1">{item.icon}</span>}
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

// Usage
const breadcrumbItems = [
  { label: 'Home', href: '/', icon: '🏠' },
  { label: 'Products', href: '/products', icon: '📦' },
  { label: 'Electronics', href: '/products/electronics' },
  { label: 'Smartphones' }, // Current page - no href
];
```

### 3.2 Data Display Components

#### Enhanced Card Component
```jsx
// components/Card.jsx
const Card = ({
  children,
  title,
  image,
  actions,
  variant = 'default',
  size = 'md',
  hover = true,
  className = '',
  ...props
}) => {
  const variantClasses = {
    default: 'card bg-base-100 shadow-xl',
    compact: 'card card-compact bg-base-100 shadow-md',
    side: 'card card-side bg-base-100 shadow-xl',
    bordered: 'card bg-base-100 border border-base-300',
  };

  const sizeClasses = {
    sm: 'w-80',
    md: 'w-96',
    lg: 'w-full max-w-lg',
    xl: 'w-full max-w-xl',
    full: 'w-full',
  };

  const hoverClass = hover ? 'card-hover' : '';

  return (
    <div
      className={`
        ${variantClasses[variant]}
        ${sizeClasses[size]}
        ${hoverClass}
        ${className}
      `}
      {...props}
    >
      {image && (
        <figure className="relative overflow-hidden">
          <img
            src={image.src}
            alt={image.alt}
            className="w-full h-48 object-cover transition-transform duration-300 hover:scale-110"
          />
          {image.badge && (
            <div className="badge badge-primary absolute top-2 right-2">
              {image.badge}
            </div>
          )}
        </figure>
      )}

      <div className="card-body">
        {title && (
          <h2 className="card-title">
            {title}
            {title.badge && (
              <div className="badge badge-secondary">{title.badge}</div>
            )}
          </h2>
        )}

        {children}

        {actions && (
          <div className="card-actions justify-end mt-4">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
};

// Usage Example
const ProductCard = () => (
  <Card
    title="Premium Headphones"
    image={{
      src: "/images/headphones.jpg",
      alt: "Premium headphones",
      badge: "New"
    }}
    variant="default"
    size="md"
    actions={
      <>
        <button className="btn btn-outline">Add to Cart</button>
        <button className="btn btn-primary">Buy Now</button>
      </>
    }
  >
    <p>High-quality wireless headphones with noise cancellation.</p>
    <div className="rating rating-sm">
      <input type="radio" name="rating-6" className="mask mask-star-2 bg-orange-400" checked />
      <input type="radio" name="rating-6" className="mask mask-star-2 bg-orange-400" checked />
      <input type="radio" name="rating-6" className="mask mask-star-2 bg-orange-400" checked />
      <input type="radio" name="rating-6" className="mask mask-star-2 bg-orange-400" checked />
      <input type="radio" name="rating-6" className="mask mask-star-2 bg-orange-400" />
    </div>
    <div className="flex items-center justify-between mt-2">
      <span className="text-2xl font-bold text-primary">$299</span>
      <span className="text-sm line-through text-base-content/60">$399</span>
    </div>
  </Card>
);
```

#### Stats Component
```jsx
// components/Stats.jsx
const Stat = ({ title, value, desc, icon, trend, className = '' }) => {
  return (
    <div className={`stat ${className}`}>
      <div className="stat-figure text-primary">
        {icon}
      </div>
      <div className="stat-title">{title}</div>
      <div className="stat-value flex items-center gap-2">
        {value}
        {trend && (
          <div className={`badge ${
            trend > 0 ? 'badge-success' : trend < 0 ? 'badge-error' : 'badge-neutral'
          }`}>
            {trend > 0 ? '↗︎' : trend < 0 ? '↘︎' : '→'} {Math.abs(trend)}%
          </div>
        )}
      </div>
      {desc && <div className="stat-desc">{desc}</div>}
    </div>
  );
};

const StatsGrid = ({ children }) => {
  return (
    <div className="stats stats-vertical lg:stats-horizontal shadow">
      {children}
    </div>
  );
};

// Usage
const DashboardStats = () => (
  <StatsGrid>
    <Stat
      title="Total Users"
      value="31K"
      desc="↗︎ 400 (22%)"
      trend={22}
      icon={
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="inline-block w-8 h-8 stroke-current">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
      }
    />
    <Stat
      title="New Registers"
      value="4,200"
      desc="↗︎ 40 (2%)"
      trend={2}
    />
    <Stat
      title="New Orders"
      value="1,200"
      desc="↘︎ 90 (14%)"
      trend={-14}
    />
  </StatsGrid>
);
```

### 3.3 Interactive Components

#### Advanced Modal System
```jsx
// components/Modal.jsx
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const Modal = ({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  dismissible = true,
  className = '',
  ...props
}) => {
  const modalRef = useRef(null);

  const sizeClasses = {
    sm: 'modal-box w-11/12 max-w-sm',
    md: 'modal-box w-11/12 max-w-md',
    lg: 'modal-box w-11/12 max-w-lg',
    xl: 'modal-box w-11/12 max-w-xl',
    full: 'modal-box w-11/12 max-w-5xl',
  };

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && dismissible) {
        onClose?.();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, dismissible, onClose]);

  if (!isOpen) return null;

  const modalContent = (
    <div className="modal modal-open">
      <div
        ref={modalRef}
        className={`${sizeClasses[size]} ${className}`}
        {...props}
      >
        <div className="flex items-center justify-between mb-4">
          {title && <h3 className="font-bold text-lg">{title}</h3>}
          {dismissible && (
            <button
              className="btn btn-sm btn-circle btn-ghost absolute right-2 top-2"
              onClick={onClose}
              aria-label="Close modal"
            >
              ✕
            </button>
          )}
        </div>

        <div className="py-4">
          {children}
        </div>
      </div>

      {dismissible && (
        <div className="modal-backdrop" onClick={onClose} />
      )}
    </div>
  );

  return createPortal(modalContent, document.body);
};

// Confirmation Modal Component
const ConfirmModal = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'warning'
}) => {
  const variantClasses = {
    success: 'btn-success',
    warning: 'btn-warning',
    error: 'btn-error',
    info: 'btn-info',
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
    >
      <p className="py-4">{message}</p>
      <div className="modal-action">
        <button
          className="btn btn-outline"
          onClick={onClose}
        >
          {cancelText}
        </button>
        <button
          className={`btn ${variantClasses[variant]}`}
          onClick={() => {
            onConfirm?.();
            onClose();
          }}
        >
          {confirmText}
        </button>
      </div>
    </Modal>
  );
};

// Usage
const ModalExample = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  return (
    <div className="space-x-2">
      <button
        className="btn btn-primary"
        onClick={() => setIsModalOpen(true)}
      >
        Open Modal
      </button>

      <button
        className="btn btn-error"
        onClick={() => setIsConfirmOpen(true)}
      >
        Delete Item
      </button>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="User Profile"
        size="lg"
      >
        <form className="space-y-4">
          <div className="form-control">
            <label className="label">
              <span className="label-text">Name</span>
            </label>
            <input type="text" className="input input-bordered" />
          </div>
          <div className="form-control">
            <label className="label">
              <span className="label-text">Email</span>
            </label>
            <input type="email" className="input input-bordered" />
          </div>
          <div className="modal-action">
            <button type="button" className="btn btn-outline" onClick={() => setIsModalOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save Changes
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmModal
        isOpen={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
        onConfirm={() => console.log('Item deleted')}
        title="Confirm Deletion"
        message="Are you sure you want to delete this item? This action cannot be undone."
        variant="error"
        confirmText="Delete"
      />
    </div>
  );
};
```

#### Button System with Loading States
```jsx
// components/Button.jsx
import { forwardRef } from 'react';

const Button = forwardRef(({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  leftIcon,
  rightIcon,
  className = '',
  onClick,
  ...props
}, ref) => {
  const variantClasses = {
    primary: 'btn-primary',
    secondary: 'btn-secondary',
    accent: 'btn-accent',
    ghost: 'btn-ghost',
    link: 'btn-link',
    outline: 'btn-outline',
    success: 'btn-success',
    warning: 'btn-warning',
    error: 'btn-error',
    info: 'btn-info',
  };

  const sizeClasses = {
    xs: 'btn-xs',
    sm: 'btn-sm',
    md: '',
    lg: 'btn-lg',
  };

  const handleClick = (e) => {
    if (!loading && !disabled && onClick) {
      onClick(e);
    }
  };

  return (
    <button
      ref={ref}
      className={`
        btn
        ${variantClasses[variant]}
        ${sizeClasses[size]}
        ${loading ? 'loading' : ''}
        ${className}
      `.trim()}
      disabled={disabled || loading}
      onClick={handleClick}
      {...props}
    >
      {loading ? (
        <span className="loading loading-spinner loading-xs"></span>
      ) : (
        <>
          {leftIcon && <span className="mr-1">{leftIcon}</span>}
          {children}
          {rightIcon && <span className="ml-1">{rightIcon}</span>}
        </>
      )}
    </button>
  );
});

// Button Group Component
const ButtonGroup = ({ children, className = '' }) => {
  return (
    <div className={`btn-group ${className}`}>
      {children}
    </div>
  );
};

// Usage Examples
const ButtonExamples = () => {
  const [loading, setLoading] = useState(false);

  const handleAsyncAction = async () => {
    setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 2000));
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      {/* Basic buttons */}
      <div className="flex gap-2">
        <Button variant="primary">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="accent">Accent</Button>
        <Button variant="ghost">Ghost</Button>
      </div>

      {/* Buttons with icons */}
      <div className="flex gap-2">
        <Button
          variant="primary"
          leftIcon="📧"
        >
          Send Email
        </Button>
        <Button
          variant="outline"
          rightIcon="↗"
        >
          External Link
        </Button>
      </div>

      {/* Loading state */}
      <Button
        variant="primary"
        loading={loading}
        onClick={handleAsyncAction}
      >
        {loading ? 'Processing...' : 'Submit'}
      </Button>

      {/* Button group */}
      <ButtonGroup>
        <Button variant="outline">Left</Button>
        <Button variant="outline">Center</Button>
        <Button variant="outline">Right</Button>
      </ButtonGroup>
    </div>
  );
};
```

### 3.4 Form Components

#### Enhanced Form System
```jsx
// components/Form.jsx
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

// Form validation schema
const contactSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  subject: z.string().min(5, 'Subject must be at least 5 characters'),
  message: z.string().min(10, 'Message must be at least 10 characters'),
  priority: z.enum(['low', 'medium', 'high']),
  newsletter: z.boolean().optional(),
});

// Input component with error handling
const FormInput = ({
  label,
  error,
  required = false,
  className = '',
  ...props
}) => {
  return (
    <div className="form-control w-full">
      <label className="label">
        <span className="label-text">
          {label}
          {required && <span className="text-error ml-1">*</span>}
        </span>
      </label>
      <input
        className={`
          input input-bordered w-full
          ${error ? 'input-error' : ''}
          ${className}
        `}
        {...props}
      />
      {error && (
        <label className="label">
          <span className="label-text-alt text-error">{error}</span>
        </label>
      )}
    </div>
  );
};

// Textarea component
const FormTextarea = ({
  label,
  error,
  required = false,
  className = '',
  ...props
}) => {
  return (
    <div className="form-control">
      <label className="label">
        <span className="label-text">
          {label}
          {required && <span className="text-error ml-1">*</span>}
        </span>
      </label>
      <textarea
        className={`
          textarea textarea-bordered h-24
          ${error ? 'textarea-error' : ''}
          ${className}
        `}
        {...props}
      />
      {error && (
        <label className="label">
          <span className="label-text-alt text-error">{error}</span>
        </label>
      )}
    </div>
  );
};

// Select component
const FormSelect = ({
  label,
  options,
  error,
  required = false,
  className = '',
  ...props
}) => {
  return (
    <div className="form-control w-full">
      <label className="label">
        <span className="label-text">
          {label}
          {required && <span className="text-error ml-1">*</span>}
        </span>
      </label>
      <select
        className={`
          select select-bordered w-full
          ${error ? 'select-error' : ''}
          ${className}
        `}
        {...props}
      >
        <option value="">Choose an option</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && (
        <label className="label">
          <span className="label-text-alt text-error">{error}</span>
        </label>
      )}
    </div>
  );
};

// Checkbox component
const FormCheckbox = ({
  label,
  error,
  className = '',
  ...props
}) => {
  return (
    <div className="form-control">
      <label className="label cursor-pointer justify-start gap-2">
        <input
          type="checkbox"
          className={`
            checkbox checkbox-primary
            ${error ? 'checkbox-error' : ''}
            ${className}
          `}
          {...props}
        />
        <span className="label-text">{label}</span>
      </label>
      {error && (
        <label className="label">
          <span className="label-text-alt text-error">{error}</span>
        </label>
      )}
    </div>
  );
};

// Main contact form
const ContactForm = ({ onSubmit }) => {
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      name: '',
      email: '',
      subject: '',
      message: '',
      priority: 'medium',
      newsletter: false,
    },
  });

  const priorityOptions = [
    { value: 'low', label: 'Low Priority' },
    { value: 'medium', label: 'Medium Priority' },
    { value: 'high', label: 'High Priority' },
  ];

  const submitForm = async (data) => {
    try {
      await onSubmit?.(data);
      reset();
    } catch (error) {
      console.error('Form submission error:', error);
    }
  };

  return (
    <div className="card w-full max-w-lg mx-auto bg-base-100 shadow-xl">
      <div className="card-body">
        <h2 className="card-title">Contact Us</h2>

        <form onSubmit={handleSubmit(submitForm)} className="space-y-4">
          <Controller
            name="name"
            control={control}
            render={({ field }) => (
              <FormInput
                {...field}
                label="Full Name"
                required
                error={errors.name?.message}
                placeholder="Enter your full name"
              />
            )}
          />

          <Controller
            name="email"
            control={control}
            render={({ field }) => (
              <FormInput
                {...field}
                type="email"
                label="Email Address"
                required
                error={errors.email?.message}
                placeholder="your@email.com"
              />
            )}
          />

          <Controller
            name="priority"
            control={control}
            render={({ field }) => (
              <FormSelect
                {...field}
                label="Priority"
                options={priorityOptions}
                error={errors.priority?.message}
              />
            )}
          />

          <Controller
            name="subject"
            control={control}
            render={({ field }) => (
              <FormInput
                {...field}
                label="Subject"
                required
                error={errors.subject?.message}
                placeholder="Brief subject of your message"
              />
            )}
          />

          <Controller
            name="message"
            control={control}
            render={({ field }) => (
              <FormTextarea
                {...field}
                label="Message"
                required
                error={errors.message?.message}
                placeholder="Tell us how we can help you..."
              />
            )}
          />

          <Controller
            name="newsletter"
            control={control}
            render={({ field: { value, onChange } }) => (
              <FormCheckbox
                checked={value}
                onChange={onChange}
                label="Subscribe to our newsletter"
                error={errors.newsletter?.message}
              />
            )}
          />

          <div className="card-actions justify-end mt-6">
            <Button
              type="button"
              variant="ghost"
              onClick={() => reset()}
              disabled={isSubmitting}
            >
              Clear
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={isSubmitting}
            >
              Send Message
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
```

---

## 4. Advanced Patterns and Best Practices

### 4.1 Theme Management System

```jsx
// hooks/useTheme.js
import { useState, useEffect, useContext, createContext } from 'react';

const ThemeContext = createContext();

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

export const ThemeProvider = ({ children, defaultTheme = 'light' }) => {
  const [theme, setTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('theme') || defaultTheme;
    }
    return defaultTheme;
  });

  useEffect(() => {
    const root = window.document.documentElement;
    root.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prevTheme => prevTheme === 'light' ? 'dark' : 'light');
  };

  const setCustomTheme = (newTheme) => {
    setTheme(newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setCustomTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

// components/ThemeSelector.jsx
const ThemeSelector = () => {
  const { theme, setCustomTheme } = useTheme();

  const themes = [
    'light', 'dark', 'cupcake', 'bumblebee', 'emerald', 'corporate',
    'synthwave', 'retro', 'cyberpunk', 'valentine', 'halloween',
    'garden', 'forest', 'aqua', 'lofi', 'pastel', 'fantasy',
    'wireframe', 'black', 'luxury', 'dracula'
  ];

  return (
    <div className="dropdown dropdown-end">
      <div tabIndex={0} role="button" className="btn m-1">
        Theme: {theme}
        <svg width="12px" height="12px" className="ml-2 h-2 w-2 fill-current opacity-60 inline-block" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2048 2048">
          <path d="M1799 349l242 241-1017 1017L7 590l242-241 775 775 775-775z"></path>
        </svg>
      </div>
      <ul tabIndex={0} className="dropdown-content z-[1] p-2 shadow-2xl bg-base-300 rounded-box w-52 max-h-96 overflow-y-auto">
        {themes.map((themeName) => (
          <li key={themeName}>
            <input
              type="radio"
              name="theme-dropdown"
              className="theme-controller btn btn-sm btn-block btn-ghost justify-start"
              aria-label={themeName}
              value={themeName}
              checked={theme === themeName}
              onChange={() => setCustomTheme(themeName)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
};
```

### 4.2 Responsive Layout System

```jsx
// components/Layout.jsx
const Layout = ({ children, sidebar = null, header = null, footer = null }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="drawer lg:drawer-open">
      <input
        id="drawer-toggle"
        type="checkbox"
        className="drawer-toggle"
        checked={sidebarOpen}
        onChange={(e) => setSidebarOpen(e.target.checked)}
      />

      <div className="drawer-content flex flex-col">
        {/* Header */}
        {header && (
          <div className="w-full">
            {header}
          </div>
        )}

        {/* Main Content */}
        <main className="flex-1 p-4 lg:p-8">
          <div className="@container">
            {children}
          </div>
        </main>

        {/* Footer */}
        {footer && (
          <footer className="mt-auto">
            {footer}
          </footer>
        )}
      </div>

      {/* Sidebar */}
      <div className="drawer-side">
        <label
          htmlFor="drawer-toggle"
          aria-label="close sidebar"
          className="drawer-overlay"
        ></label>

        <aside className="min-h-full w-80 bg-base-200">
          {sidebar}
        </aside>
      </div>
    </div>
  );
};

// Grid system with container queries
const ResponsiveGrid = ({ children, columns = 'auto' }) => {
  const gridClasses = {
    auto: 'grid grid-cols-1 @sm:grid-cols-2 @lg:grid-cols-3 @xl:grid-cols-4',
    1: 'grid grid-cols-1',
    2: 'grid grid-cols-1 @sm:grid-cols-2',
    3: 'grid grid-cols-1 @sm:grid-cols-2 @lg:grid-cols-3',
    4: 'grid grid-cols-1 @sm:grid-cols-2 @lg:grid-cols-3 @xl:grid-cols-4',
    6: 'grid grid-cols-2 @sm:grid-cols-3 @lg:grid-cols-4 @xl:grid-cols-6',
  };

  return (
    <div className={`@container`}>
      <div className={`${gridClasses[columns]} gap-4`}>
        {children}
      </div>
    </div>
  );
};
```

### 4.3 Animation and Transition System

```jsx
// components/Animations.jsx
import { motion } from 'framer-motion';

// Fade in animation
export const FadeIn = ({ children, delay = 0, direction = 'up' }) => {
  const directions = {
    up: { y: 40, x: 0 },
    down: { y: -40, x: 0 },
    left: { y: 0, x: 40 },
    right: { y: 0, x: -40 },
  };

  return (
    <motion.div
      initial={{
        opacity: 0,
        ...directions[direction]
      }}
      whileInView={{
        opacity: 1,
        x: 0,
        y: 0
      }}
      transition={{
        duration: 0.5,
        delay
      }}
      viewport={{ once: true }}
    >
      {children}
    </motion.div>
  );
};

// Stagger children animation
export const StaggerChildren = ({ children, className = '' }) => {
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true }}
      variants={{
        hidden: { opacity: 0 },
        visible: {
          opacity: 1,
          transition: {
            staggerChildren: 0.1,
          },
        },
      }}
    >
      {children}
    </motion.div>
  );
};

// Scale on hover
export const ScaleOnHover = ({ children, scale = 1.05 }) => {
  return (
    <motion.div
      whileHover={{ scale }}
      transition={{ type: 'spring', stiffness: 300 }}
    >
      {children}
    </motion.div>
  );
};

// Usage in a component
const AnimatedGallery = () => {
  const images = [
    { id: 1, src: '/image1.jpg', alt: 'Image 1' },
    { id: 2, src: '/image2.jpg', alt: 'Image 2' },
    { id: 3, src: '/image3.jpg', alt: 'Image 3' },
    // ... more images
  ];

  return (
    <StaggerChildren className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {images.map((image, index) => (
        <motion.div
          key={image.id}
          variants={{
            hidden: { opacity: 0, y: 20 },
            visible: { opacity: 1, y: 0 },
          }}
        >
          <ScaleOnHover>
            <div className="card bg-base-100 shadow-xl overflow-hidden">
              <figure>
                <img
                  src={image.src}
                  alt={image.alt}
                  className="w-full h-48 object-cover"
                />
              </figure>
            </div>
          </ScaleOnHover>
        </motion.div>
      ))}
    </StaggerChildren>
  );
};
```

### 4.4 Data Loading and Error States

```jsx
// hooks/useAsync.js
import { useState, useEffect, useCallback } from 'react';

export const useAsync = (asyncFunction, dependencies = []) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const execute = useCallback(async (...args) => {
    setLoading(true);
    setError(null);

    try {
      const result = await asyncFunction(...args);
      setData(result);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, dependencies);

  useEffect(() => {
    execute();
  }, [execute]);

  return { data, loading, error, refetch: execute };
};

// components/LoadingStates.jsx
const LoadingSpinner = ({ size = 'md', className = '' }) => {
  const sizeClasses = {
    xs: 'loading-xs',
    sm: 'loading-sm',
    md: 'loading-md',
    lg: 'loading-lg',
  };

  return (
    <div className={`flex justify-center items-center p-8 ${className}`}>
      <span className={`loading loading-spinner ${sizeClasses[size]}`}></span>
    </div>
  );
};

const LoadingSkeleton = ({ className = '' }) => {
  return (
    <div className={`animate-pulse ${className}`}>
      <div className="card bg-base-100 shadow-xl">
        <div className="card-body">
          <div className="h-4 bg-base-300 rounded w-3/4 mb-2"></div>
          <div className="h-4 bg-base-300 rounded w-1/2 mb-4"></div>
          <div className="h-20 bg-base-300 rounded mb-4"></div>
          <div className="flex gap-2">
            <div className="h-8 bg-base-300 rounded w-20"></div>
            <div className="h-8 bg-base-300 rounded w-20"></div>
          </div>
        </div>
      </div>
    </div>
  );
};

const ErrorDisplay = ({ error, onRetry, className = '' }) => {
  return (
    <div className={`card bg-base-100 shadow-xl ${className}`}>
      <div className="card-body items-center text-center">
        <div className="text-error text-6xl mb-4">⚠️</div>
        <h2 className="card-title text-error">Something went wrong</h2>
        <p className="text-base-content/70">
          {error?.message || 'An unexpected error occurred'}
        </p>
        {onRetry && (
          <div className="card-actions">
            <button className="btn btn-primary" onClick={onRetry}>
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// Usage in a data component
const UsersList = () => {
  const { data: users, loading, error, refetch } = useAsync(
    async () => {
      const response = await fetch('/api/users');
      if (!response.ok) throw new Error('Failed to fetch users');
      return response.json();
    },
    []
  );

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, index) => (
          <LoadingSkeleton key={index} />
        ))}
      </div>
    );
  }

  if (error) {
    return <ErrorDisplay error={error} onRetry={refetch} />;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {users?.map((user) => (
        <div key={user.id} className="card bg-base-100 shadow-xl">
          <div className="card-body">
            <h2 className="card-title">{user.name}</h2>
            <p>{user.email}</p>
            <div className="card-actions justify-end">
              <button className="btn btn-primary btn-sm">View Profile</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
```

---

## 5. Performance Optimization

### 5.1 CSS Optimization

```css
/* Optimize for production */
@layer utilities {
  /* Custom utilities for performance */
  .gpu-accelerated {
    transform: translateZ(0);
    backface-visibility: hidden;
    perspective: 1000px;
  }

  .smooth-scroll {
    scroll-behavior: smooth;
  }

  .optimized-animations {
    will-change: transform, opacity;
  }
}

/* Reduce bundle size with selective imports */
@import 'tailwindcss/base';
@import 'tailwindcss/components';
@import 'tailwindcss/utilities';

/* Only import needed DaisyUI components */
@import 'daisyui/dist/components/button';
@import 'daisyui/dist/components/card';
@import 'daisyui/dist/components/modal';
```

### 5.2 Component Lazy Loading

```jsx
// components/LazyComponents.jsx
import { lazy, Suspense } from 'react';

// Lazy load heavy components
const LazyChart = lazy(() => import('./Chart'));
const LazyDataTable = lazy(() => import('./DataTable'));
const LazyImageGallery = lazy(() => import('./ImageGallery'));

// Wrapper component for consistent loading states
const LazyWrapper = ({ children, fallback = <LoadingSpinner /> }) => {
  return (
    <Suspense fallback={fallback}>
      {children}
    </Suspense>
  );
};

// Usage
const Dashboard = () => {
  return (
    <div className="space-y-8">
      <div className="stats shadow">
        {/* Always loaded stats */}
      </div>

      <LazyWrapper fallback={<LoadingSkeleton className="h-64" />}>
        <LazyChart />
      </LazyWrapper>

      <LazyWrapper>
        <LazyDataTable />
      </LazyWrapper>
    </div>
  );
};
```

### 5.3 Image Optimization

```jsx
// components/OptimizedImage.jsx
import { useState } from 'react';

const OptimizedImage = ({
  src,
  alt,
  className = '',
  sizes = '100vw',
  priority = false,
  ...props
}) => {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  // Generate responsive image URLs (if using a service like Cloudinary)
  const generateSrcSet = (baseSrc) => {
    const widths = [320, 640, 768, 1024, 1280, 1920];
    return widths
      .map(width => `${baseSrc}?w=${width} ${width}w`)
      .join(', ');
  };

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {!loaded && !error && (
        <div className="absolute inset-0 bg-base-300 animate-pulse flex items-center justify-center">
          <span className="loading loading-spinner loading-md"></span>
        </div>
      )}

      {error ? (
        <div className="absolute inset-0 bg-base-300 flex items-center justify-center">
          <span className="text-base-content/50">Failed to load</span>
        </div>
      ) : (
        <img
          src={src}
          srcSet={generateSrcSet(src)}
          sizes={sizes}
          alt={alt}
          className={`
            w-full h-full object-cover transition-opacity duration-300
            ${loaded ? 'opacity-100' : 'opacity-0'}
          `}
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
          loading={priority ? 'eager' : 'lazy'}
          {...props}
        />
      )}
    </div>
  );
};
```

---

## 6. Accessibility and Testing

### 6.1 Accessibility Best Practices

```jsx
// components/AccessibleComponents.jsx

// Accessible Modal
const AccessibleModal = ({
  isOpen,
  onClose,
  title,
  children,
  id = 'modal'
}) => {
  const modalRef = useRef(null);
  const previousActiveElement = useRef(null);

  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement;
      modalRef.current?.focus();
    } else {
      previousActiveElement.current?.focus();
    }
  }, [isOpen]);

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      onClose();
    }

    // Trap focus within modal
    if (e.key === 'Tab') {
      const focusableElements = modalRef.current.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="modal modal-open"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${id}-title`}
    >
      <div
        ref={modalRef}
        className="modal-box"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <h3 id={`${id}-title`} className="font-bold text-lg">
          {title}
        </h3>

        <button
          className="btn btn-sm btn-circle btn-ghost absolute right-2 top-2"
          onClick={onClose}
          aria-label="Close modal"
        >
          ✕
        </button>

        <div className="py-4">
          {children}
        </div>
      </div>
    </div>
  );
};

// Accessible Button with proper ARIA attributes
const AccessibleButton = ({
  children,
  loading = false,
  disabled = false,
  ariaLabel,
  ariaDescribedBy,
  onClick,
  ...props
}) => {
  return (
    <button
      className="btn"
      disabled={disabled || loading}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      aria-busy={loading}
      onClick={onClick}
      {...props}
    >
      {loading && <span className="sr-only">Loading...</span>}
      {children}
    </button>
  );
};

// Skip to content link
const SkipToContent = () => {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 bg-primary text-primary-content px-4 py-2 rounded z-50"
    >
      Skip to main content
    </a>
  );
};
```

### 6.2 Testing Setup

```jsx
// __tests__/Button.test.jsx
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import Button from '../components/Button';

describe('Button Component', () => {
  test('renders button with text', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: /click me/i })).toBeInTheDocument();
  });

  test('calls onClick when clicked', () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Click me</Button>);

    fireEvent.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  test('shows loading state', () => {
    render(<Button loading>Loading button</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  test('
