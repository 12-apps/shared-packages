import ArrowDropDown from '@mui/icons-material/ArrowDropDown';
import PhoneIcon from '@mui/icons-material/Phone';
import Box from '@mui/material/Box/index.js';
import InputAdornment from '@mui/material/InputAdornment/index.js';
import ListItemIcon from '@mui/material/ListItemIcon/index.js';
import ListItemText from '@mui/material/ListItemText/index.js';
import Menu from '@mui/material/Menu/index.js';
import MenuItem from '@mui/material/MenuItem/index.js';
import TextField from '@mui/material/TextField/index.js';
import Typography from '@mui/material/Typography/index.js';
import { alpha, styled, useTheme } from '@mui/material/styles/index.js';
import type { FC} from 'react';
import React, {  } from 'react';

import { countries } from './countries';
import { usePhoneInput } from './PhoneInput.hooks';
import type { CountryData,PhoneInputProps } from './PhoneInput.types';
import type { PhoneInputCopy } from '../../../copy';

import { fieldEdge } from '../../../tokens/field-edge';

// Country data with expanded support

// Styled components
const GlassTextField = styled(TextField)(({ theme }) => ({
  '& .MuiOutlinedInput-root': {
    background: `linear-gradient(135deg, ${alpha(theme.palette.background.paper, 0.8)} 0%, ${alpha(theme.palette.background.paper, 0.6)} 100%)`,
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    border: `1px solid ${fieldEdge(theme)}`,
    transition: theme.transitions.create(['border-color', 'box-shadow', 'background']),
    '&:hover': {
      background: `linear-gradient(135deg, ${alpha(theme.palette.background.paper, 0.9)} 0%, ${alpha(theme.palette.background.paper, 0.7)} 100%)`,
      borderColor: theme.palette.primary.main },
    '&.Mui-focused': {
      background: theme.palette.background.paper,
      boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.25)}` },
    '& fieldset': {
      border: 'none' } },
  '& .MuiInputLabel-root': {
    '&.Mui-focused': {
      color: theme.palette.primary.main } } }));

const CountrySelector = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  padding: theme.spacing(0.5, 1),
  borderRadius: theme.shape.borderRadius,
  cursor: 'pointer',
  transition: theme.transitions.create(['background-color']),
  '&:hover': {
    backgroundColor: alpha(theme.palette.primary.main, 0.08) } }));

const CountryMenu = styled(Menu)(({ theme }) => ({
  '& .MuiPaper-root': {
    background: `linear-gradient(135deg, ${alpha(theme.palette.background.paper, 0.98)} 0%, ${alpha(theme.palette.background.paper, 0.95)} 100%)`,
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: `1px solid ${alpha(theme.palette.divider, 0.18)}`,
    maxHeight: 400 } }));

// Helper functions with enhanced validation
// The text field itself with its two adornments. Split out so PhoneInput is
// prop defaults, the hook call and composition.
const PhoneField: React.FC<{
  TextFieldComponent: React.ElementType;
  variant: PhoneInputProps['variant'];
  label?: React.ReactNode;
  placeholder?: string;
  value: string;
  validation: { hasError: boolean; helperText?: React.ReactNode };
  disabled: boolean;
  required: boolean;
  fullWidth: boolean;
  icon?: React.ReactNode;
  isValid: boolean;
  selectedCountry?: CountryData;
  anchorEl: HTMLElement | null;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onFocus: () => void;
  onBlur: () => void;
  onCountryOpen: (event: React.MouseEvent<HTMLElement>) => void;
  onCountryOpenViaKeyboard: (element: HTMLElement) => void;
  copy: PhoneInputCopy;
}> = ({
  TextFieldComponent,
  copy,
  variant,
  label,
  placeholder,
  value,
  validation,
  disabled,
  required,
  fullWidth,
  icon,
  isValid,
  selectedCountry,
  anchorEl,
  onChange,
  onFocus,
  onBlur,
  onCountryOpen,
  onCountryOpenViaKeyboard }) => (
      <TextFieldComponent
        variant={variant === 'glass' ? 'outlined' : variant}
        label={label}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        onFocus={onFocus}
        onBlur={onBlur}
        error={validation.hasError}
        helperText={validation.helperText}
        disabled={disabled}
        required={required}
        fullWidth={fullWidth}
        type="tel"
        data-testid="phone-input-field"
        InputProps={{
          startAdornment: (
            <CountryAdornment
              selectCountryLabel={copy.selectCountry}
              country={selectedCountry}
              menuOpen={Boolean(anchorEl)}
              onOpen={onCountryOpen}
              onOpenViaKeyboard={onCountryOpenViaKeyboard}
            />
          ),
          endAdornment: <ValidityAdornment icon={icon} isValid={isValid} /> }}
        sx={{
          '& input': {
            letterSpacing: '0.5px' } }}
      />
);

const PHONE_INPUT_DEFAULTS = {
  variant: 'outlined',
  label: 'Phone Number',
  placeholder: 'Enter phone number',
  icon: <PhoneIcon />,
  defaultValue: '',
  countryCode: 'US',
  floating: false,
  error: false,
  disabled: false,
  required: false,
  fullWidth: true } satisfies Partial<PhoneInputProps>;

// Drops explicitly-undefined props before the merge, so `prop={undefined}` falls
// back to the default exactly as a destructuring default would. Eleven separate
// destructuring defaults were most of this component's branch count.
const definedProps = (props: PhoneInputProps): Partial<PhoneInputProps> =>
  Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined),
  ) as Partial<PhoneInputProps>;

const CountryAdornment: React.FC<{
  country?: CountryData;
  menuOpen: boolean;
  onOpen: (event: React.MouseEvent<HTMLElement>) => void;
  onOpenViaKeyboard: (element: HTMLElement) => void;
  selectCountryLabel: string;
}> = ({ country, menuOpen, onOpen, onOpenViaKeyboard, selectCountryLabel }) => (
  <InputAdornment position="start" data-testid="phone-input-start-adornment">
    <CountrySelector
      onClick={onOpen}
      role="button"
      aria-label={selectCountryLabel}
      aria-expanded={menuOpen}
      tabIndex={0}
      data-testid="country-selector"
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onOpenViaKeyboard(e.currentTarget as HTMLElement);
      }}
    >
      <Typography variant="h6" component="span" sx={{ mr: 0.5 }} data-testid="country-flag">
        {country?.flag}
      </Typography>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ mr: 0.5 }}
        data-testid="country-dial-code"
      >
        {country?.dial}
      </Typography>
      <ArrowDropDown fontSize="small" data-testid="country-dropdown-icon" />
    </CountrySelector>
  </InputAdornment>
);

// The trailing icon turns green once the number validates.
const ValidityAdornment: React.FC<{ icon?: React.ReactNode; isValid: boolean }> = ({
  icon,
  isValid }) => {
  const theme = useTheme();

  if (!icon) return null;

  return (
    <InputAdornment position="end" data-testid="phone-input-end-adornment">
      <Box
        sx={{
          color: isValid ? theme.palette.success.main : theme.palette.text.secondary,
          transition: 'color 0.3s ease' }}
        data-testid="phone-input-icon"
      >
        {icon}
      </Box>
    </InputAdornment>
  );
};

const CountryPicker: React.FC<{
  anchorEl: HTMLElement | null;
  selectedCode?: CountryData['code'];
  onClose: () => void;
  onSelect: (country: CountryData) => void;
}> = ({ anchorEl, selectedCode, onClose, onSelect }) => {
  const theme = useTheme();

  return (
        <CountryMenu
          anchorEl={anchorEl}
          open={Boolean(anchorEl)}
          onClose={onClose}
          anchorOrigin={{
            vertical: 'bottom',
            horizontal: 'left' }}
          transformOrigin={{
            vertical: 'top',
            horizontal: 'left' }}
          data-testid="country-menu"
        >
          {countries.map((country) => (
            <MenuItem
              key={country.code}
              onClick={() => onSelect(country)}
              selected={country.code === selectedCode}
              data-testid={`country-option-${country.code}`}
              sx={{
                '&:hover': {
                  background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.1)} 0%, ${alpha(theme.palette.primary.main, 0.05)} 100%)` } }}
            >
              <ListItemIcon sx={{ minWidth: 36 }}>
                <Typography variant="h5" component="span">
                  {country.flag}
                </Typography>
              </ListItemIcon>
              <ListItemText
                primary={country.name}
                secondary={country.dial}
                primaryTypographyProps={{ fontSize: '0.9rem' }}
                secondaryTypographyProps={{ fontSize: '0.8rem' }}
              />
            </MenuItem>
          ))}
        </CountryMenu>
  );
};

// The field shows an error either because the caller says so, or because what
// has been typed does not validate and the user has moved on.
const resolveValidation = ({
  error,
  errorMessage,
  isValid,
  value,
  isFocused,
  helper,
  countryName,
  copy }: {
  error: boolean;
  errorMessage?: string;
  isValid: boolean;
  value: string;
  isFocused: boolean;
  helper?: React.ReactNode;
  countryName?: string;
  copy: PhoneInputCopy;
}) => {
  const looksInvalid = !isValid && value !== '' && !isFocused;

  return {
    hasError: error || looksInvalid,
    helperText:
      errorMessage ||
      (looksInvalid ? copy.invalidNumber(countryName || copy.unknownCountry) : helper) };
};

export const PhoneInput: FC<PhoneInputProps> = (props) => {
  const { copy } = props;
  const {
    variant,
    label,
    placeholder,
    icon,
    defaultValue,
    countryCode: initialCountryCode,
    floating,
    onChange,
    helper,
    error,
    errorMessage,
    disabled,
    required,
    fullWidth } = { ...PHONE_INPUT_DEFAULTS, ...definedProps(props) };
  const {
    value,
    selectedCountry,
    anchorEl,
    isValid,
    isFocused,
    setIsFocused,
    setAnchorEl,
    handleCountryClick,
    handleCountryClose,
    handleCountrySelect,
    handleChange,
    handleBlur } = usePhoneInput({ defaultValue, initialCountryCode, onChange });

  const validation = resolveValidation({
    error,
    errorMessage,
    isValid,
    value,
    isFocused,
    helper,
    countryName: selectedCountry?.name,
    copy });

  const TextFieldComponent = variant === 'glass' ? GlassTextField : TextField;

  return (
    <Box data-testid="phone-input-container">
      <PhoneField
        copy={copy}
        TextFieldComponent={TextFieldComponent}
        variant={variant}
        label={floating ? undefined : label}
        placeholder={placeholder}
        value={value}
        validation={validation}
        disabled={disabled}
        required={required}
        fullWidth={fullWidth}
        icon={icon}
        isValid={isValid}
        selectedCountry={selectedCountry}
        anchorEl={anchorEl}
        onChange={handleChange}
        onFocus={() => setIsFocused(true)}
        onBlur={handleBlur}
        onCountryOpen={handleCountryClick}
        onCountryOpenViaKeyboard={setAnchorEl}
      />

      <CountryPicker
        anchorEl={anchorEl}
        selectedCode={selectedCountry?.code}
        onClose={handleCountryClose}
        onSelect={handleCountrySelect}
      />
    </Box>
  );
};

// Export default
export default PhoneInput;
