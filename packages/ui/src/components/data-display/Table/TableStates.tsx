import Box from '@mui/material/Box';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableRow from '@mui/material/TableRow';
import React from 'react';


export const NoDataPlaceholder: React.FC<{ emptyText: string }> = ({ emptyText }) => (
  <Box py={4} color="text.secondary">
    {emptyText}
  </Box>
);

export const EmptyRow: React.FC<{ colSpan: number; children: React.ReactNode }> = ({
  colSpan,
  children }) => (
  <TableBody>
    <TableRow>
      <TableCell colSpan={colSpan} align="center">
        {children}
      </TableCell>
    </TableRow>
  </TableBody>
);
