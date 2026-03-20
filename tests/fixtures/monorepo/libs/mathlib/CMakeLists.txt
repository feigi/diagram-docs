cmake_minimum_required(VERSION 3.20)
project(mathlib C)

add_library(mathlib src/math.c)
target_include_directories(mathlib PUBLIC include)
