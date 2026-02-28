import { alpha, createTheme } from '@mui/material/styles';

const OPS_PRIMARY = '#0f172a';
const OPS_LIME = '#99c000';
const OPS_SKY = '#0284c7';
const OPS_BG = '#eef3fb';

export const opsTheme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: OPS_PRIMARY,
      light: '#1e293b',
      dark: '#020617',
      contrastText: '#ffffff',
    },
    secondary: {
      main: OPS_LIME,
      light: '#b8d94c',
      dark: '#6f8f00',
      contrastText: '#0f172a',
    },
    info: {
      main: OPS_SKY,
    },
    background: {
      default: OPS_BG,
      paper: '#ffffff',
    },
    success: {
      main: '#16a34a',
    },
    warning: {
      main: '#d97706',
    },
    error: {
      main: '#dc2626',
    },
  },
  shape: {
    borderRadius: 16,
  },
  typography: {
    fontFamily: "'Candara', 'Segoe UI', Tahoma, sans-serif",
    h5: {
      fontWeight: 700,
      letterSpacing: '-0.01em',
    },
    h6: {
      fontWeight: 700,
      letterSpacing: '-0.01em',
    },
    button: {
      fontWeight: 700,
      textTransform: 'none',
      letterSpacing: '0.01em',
    },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          background:
            'radial-gradient(1200px 600px at 90% -100px, rgba(153,192,0,0.15), transparent 70%), radial-gradient(1100px 620px at -10% 0px, rgba(2,132,199,0.14), transparent 68%), #eef3fb',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          border: '1px solid #d8e2f0',
          boxShadow: '0 12px 32px rgba(15, 23, 42, 0.08)',
          borderRadius: 18,
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          minHeight: 38,
          paddingLeft: 14,
          paddingRight: 14,
        },
        contained: {
          boxShadow: '0 10px 20px rgba(15, 23, 42, 0.18)',
          backgroundImage: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
          '&:hover': {
            backgroundImage: 'linear-gradient(135deg, #020617 0%, #0f172a 100%)',
            boxShadow: '0 12px 22px rgba(15, 23, 42, 0.24)',
          },
        },
        containedSecondary: {
          backgroundImage: 'linear-gradient(135deg, #99c000 0%, #b8d94c 100%)',
          color: '#0f172a',
          '&:hover': {
            backgroundImage: 'linear-gradient(135deg, #84a700 0%, #a7cc2e 100%)',
          },
        },
        outlined: {
          borderColor: '#c6d4e6',
          backgroundColor: alpha('#ffffff', 0.68),
          '&:hover': {
            borderColor: '#94a8c3',
            backgroundColor: alpha('#ffffff', 0.88),
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          fontWeight: 700,
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 12,
            backgroundColor: alpha('#ffffff', 0.92),
          },
        },
      },
    },
    MuiBottomNavigation: {
      styleOverrides: {
        root: {
          height: 68,
          backgroundColor: alpha('#ffffff', 0.96),
          backdropFilter: 'blur(8px)',
          borderTop: '1px solid #d7e1ef',
        },
      },
    },
    MuiBottomNavigationAction: {
      styleOverrides: {
        root: {
          minWidth: 62,
          color: '#51637d',
          '&.Mui-selected': {
            color: '#0f172a',
            '& .MuiBottomNavigationAction-label': {
              fontWeight: 700,
            },
          },
        },
      },
    },
  },
});

